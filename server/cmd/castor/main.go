// Command castor is the single-binary Castor server: it serves the JSON API and
// the embedded React UI, talking to the local Docker engine over the mounted
// socket and (optionally) Swarm and a mounted kubeconfig.
//
// Wiring order: brand integrity check -> config -> DB (migrate + seed) ->
// secret-key check -> providers -> registry -> cache (poller + watcher) -> TLS
// manager -> authz -> router -> http.Server(s), then a graceful shutdown on
// SIGINT/SIGTERM.
//
// TLS: by default the UI/API are served over HTTPS on CASTOR_HTTPS_ADDR with a
// generated self-signed certificate, while CASTOR_HTTP_ADDR redirects to HTTPS
// (serving only /api/v1/healthz and ACME challenges directly). The persisted
// tls.mode setting (editable in the UI: self-signed, custom or acme) overrides
// the CASTOR_TLS_MODE default; CASTOR_TLS_MODE=off is the only way to keep the
// historical plain-HTTP single listener (deployments behind a TLS-terminating
// reverse proxy) and then makes the setting read-only.
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gtek-it/castor/server/internal/api"
	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/brand"
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/provider/kube"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/tlsmgr"
	"github.com/gtek-it/castor/server/internal/version"
	"github.com/gtek-it/castor/server/web"
)

func main() {
	// Subcommand dispatch. The distroless final image has no shell and no
	// curl/wget, so the container HEALTHCHECK (Dockerfile + compose) invokes
	// `castor healthcheck`, which probes the local /api/v1/healthz endpoint and
	// exits 0 (healthy) or 1 (unhealthy). `castor version` prints build metadata.
	// Any other arg falls through to running the server.
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			os.Exit(runHealthcheck())
		case "version", "--version", "-v":
			fmt.Printf("castor %s (commit %s)\n", version.Version, version.Commit)
			return
		case "entrypoint":
			// Container entrypoint: when running as root, drop to the unprivileged
			// uid + the docker socket's group and re-exec as `serve`; otherwise run
			// the server directly. See entrypoint.go. Never returns.
			runEntrypoint()
			return
		case "serve":
			// Internal sentinel used by the entrypoint re-exec (already dropped to
			// non-root). Fall through to running the server in-process.
		}
	}

	log.SetFlags(log.LstdFlags | log.LUTC)
	log.Printf("castor %s (commit %s) starting", version.Version, version.Commit)

	// Brand integrity check on the embedded UI, before anything listens. See
	// verifyBrand for what it does and does not cover.
	verifyBrand()

	if err := run(); err != nil {
		log.Fatalf("castor: fatal: %v", err)
	}
}

// verifyBrand runs brand.Verify against the embedded UI and aborts startup
// when the logo or the attribution has been altered inside a distributed
// binary. Castor is Apache-2.0: this does not prevent a modified recompilation
// (NOTICE and TRADEMARKS.md cover that case); it only makes tampering with the
// brand inside a shipped image detectable. A binary built without the UI
// bundle (dev builds, `go build` without a prior UI build) logs a warning and
// continues, since there is nothing to check.
func verifyBrand() {
	err := brand.Verify(web.FS())
	switch {
	case err == nil:
		log.Printf("castor: brand: %s verified", brand.Attribution)
	case errors.Is(err, brand.ErrNoUIBundle):
		log.Printf("castor: brand: UI bundle absent, brand check skipped")
	default:
		log.Fatalf("castor: brand integrity check failed: %v — see NOTICE and TRADEMARKS.md", err)
	}
}

// runHealthcheck performs a GET against the locally-listening server's
// /api/v1/healthz and returns a process exit code: 0 when the endpoint answers
// 2xx, 1 otherwise. It reads CASTOR_HTTP_ADDR (default ":8080") to find the
// port and always dials the loopback interface (the listen addr may be an
// unspecified/wildcard host like ":8080" or "0.0.0.0:8080"). It stays on plain
// HTTP whatever the TLS mode: the HTTP listener always serves /api/v1/healthz
// without redirecting it.
func runHealthcheck() int {
	addr := os.Getenv("CASTOR_HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// Tolerate a bare port like "8080".
		host, port = "", strings.TrimPrefix(addr, ":")
	}
	if host == "" || host == "0.0.0.0" || host == "::" || host == "[::]" {
		host = "127.0.0.1"
	}

	url := fmt.Sprintf("http://%s/api/v1/healthz", net.JoinHostPort(host, port))

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: %v\n", err)
		return 1
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return 0
	}
	fmt.Fprintf(os.Stderr, "healthcheck: unexpected status %d\n", resp.StatusCode)
	return 1
}

func run() error {
	// 1. Config + validation (refuse to start without a 32-byte secret key).
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		return err
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// 2. Database: open, migrate, seed (idempotent).
	st, err := store.Connect(cfg)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	migCtx, cancelMig := context.WithTimeout(rootCtx, 30*time.Second)
	defer cancelMig()
	if err := st.Migrate(migCtx); err != nil {
		return err
	}
	if err := st.Seed(migCtx); err != nil {
		return err
	}

	// 3. Providers + registry.
	reg := provider.NewRegistry()

	dockerP, err := docker.New(rootCtx, docker.Config{SelfContainerID: cfg.SelfContainerID})
	if err != nil {
		return err
	}
	defer func() { _ = dockerP.Close() }()

	// Resolve Castor's own container id for the self-protection guard.
	selfID, selfResolved := docker.ResolveSelfContainerID(rootCtx, dockerP, cfg.SelfContainerID)
	if selfResolved {
		log.Printf("castor: self-container identified: %s", short(selfID))
	} else {
		log.Printf("castor: WARNING self-container could NOT be identified; destructive container actions will be denied (set CASTOR_SELF_CONTAINER_ID)")
	}
	// Recreate the docker provider's self id if we discovered it at runtime.
	if selfResolved && cfg.SelfContainerID == "" {
		dockerP, err = docker.New(rootCtx, docker.Config{SelfContainerID: selfID})
		if err != nil {
			return err
		}
		defer func() { _ = dockerP.Close() }()
	}
	reg.Register(dockerP)

	var swarmP *swarm.SwarmProvider
	if cfg.EnableSwarm {
		swarmP = swarm.New(dockerP.Client())
		reg.Register(swarmP)
	}

	var kubeP *kube.KubeProvider
	if cfg.KubeEnabled() {
		kubeP, err = kube.New(cfg.Kubeconfig)
		if err != nil {
			log.Printf("castor: kube provider disabled (%v)", err)
			kubeP = nil
		} else {
			reg.Register(kubeP)
			log.Printf("castor: kubernetes provider enabled (kubeconfig=%s)", cfg.Kubeconfig)
		}
	}

	// 4. Cache manager (snapshot store + poller + watcher + stream registry).
	mgr := cache.NewManager(cfg, dockerP, swarmP, kubeP)
	mgr.Start(rootCtx)

	// 5. TLS manager. CASTOR_TLS_MODE=off forces TLS off (the setting is then
	// read-only in the UI); otherwise the persisted tls.mode (Settings UI) wins
	// over the env default. The self-signed certificate is generated/loaded
	// here unless the mode is off.
	tlsMode, tlsManagedByEnv := resolveTLSMode(rootCtx, cfg, st)
	if tlsMode != config.TLSModeOff {
		if err := cfg.ValidateTLSListeners(); err != nil {
			return err
		}
	}
	tlsMgr, err := tlsmgr.New(tlsmgr.Options{
		Dir:             cfg.TLSDir,
		Mode:            tlsMode,
		ManagedByEnv:    tlsManagedByEnv,
		TrustProxy:      cfg.TrustProxy,
		SelfSignedHosts: cfg.TLSSelfSignedHosts,
		HTTPSAddr:       cfg.HTTPSAddr,
	})
	if err != nil {
		return err
	}
	defer tlsMgr.Close()
	loadPersistedTLS(rootCtx, cfg, st, tlsMgr, tlsMode)

	// 6. Authz dependencies + destructive-action guard.
	azDeps := &authz.Deps{
		Store:              st,
		TrustProxy:         cfg.TrustProxy,
		AllowedOrigins:     cfg.AllowedOrigins,
		SecretKey:          cfg.SecretKey,
		AdminRoleID:        store.RoleIDAdmin,
		SessionTTL:         cfg.SessionTTL,
		SessionAbsoluteTTL: cfg.SessionAbsoluteTTL,
		TLSEffectiveMode:   tlsMgr.EffectiveMode,
	}
	guard := authz.NewGuard(st, selfID, selfResolved)

	// 7. API server + router (REST + WS + embedded UI).
	apiServer := api.NewServer(cfg, st, azDeps, guard, mgr, reg)
	apiServer.SetTLSManager(tlsMgr)
	handler := apiServer.Router()

	// 8. HTTP server(s) with sane timeouts.
	newServer := func(addr string, h http.Handler) *http.Server {
		return &http.Server{
			Addr:              addr,
			Handler:           h,
			ReadHeaderTimeout: 15 * time.Second,
			// No WriteTimeout: long-lived WebSocket/stream responses use it; the WS
			// handler manages its own per-frame deadlines.
			IdleTimeout: 120 * time.Second,
		}
	}

	var servers []*http.Server
	errCh := make(chan error, 2)
	serve := func(srv *http.Server, useTLS bool) {
		servers = append(servers, srv)
		go func() {
			var err error
			if useTLS {
				// Empty cert/key paths: certificates come from TLSConfig.GetCertificate.
				err = srv.ListenAndServeTLS("", "")
			} else {
				err = srv.ListenAndServe()
			}
			if err != nil && !errors.Is(err, http.ErrServerClosed) {
				errCh <- fmt.Errorf("listen %s: %w", srv.Addr, err)
			}
		}()
	}

	if tlsMode == config.TLSModeOff {
		// Historical behavior: one plain-HTTP listener, no redirect.
		log.Printf("castor: listening on %s (tls off) -> %s", cfg.HTTPAddr, displayURL("http", cfg.HTTPAddr))
		serve(newServer(cfg.HTTPAddr, handler), false)
	} else {
		httpsSrv := newServer(cfg.HTTPSAddr, handler)
		httpsSrv.TLSConfig = tlsMgr.TLSConfig()
		status := tlsMgr.Status()
		certDesc := "none"
		if status.Certificate != nil {
			certDesc = fmt.Sprintf("%s, sha256 %s", status.Certificate.Source, status.Certificate.FingerprintSHA256)
		}
		log.Printf("castor: https listening on %s -> %s (tls mode %s, effective %s, certificate %s)",
			cfg.HTTPSAddr, displayURL("https", cfg.HTTPSAddr), status.Mode, status.EffectiveMode, certDesc)
		serve(httpsSrv, true)

		if cfg.HTTPRedirect {
			log.Printf("castor: http listening on %s -> redirects to %s (only %s and ACME challenges are served over http)",
				cfg.HTTPAddr, displayURL("https", cfg.HTTPSAddr), tlsmgr.HealthzPath)
		} else {
			log.Printf("castor: http listening on %s -> %s (CASTOR_HTTP_REDIRECT=false: served without redirect)",
				cfg.HTTPAddr, displayURL("http", cfg.HTTPAddr))
		}
		serve(newServer(cfg.HTTPAddr, tlsMgr.HTTPHandler(handler, cfg.HTTPRedirect)), false)
	}

	// Background session housekeeping.
	go runSessionGC(rootCtx, st)

	select {
	case <-rootCtx.Done():
		log.Printf("castor: shutdown signal received")
	case err := <-errCh:
		return err
	}

	// 9. Graceful shutdown of every listener.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for _, srv := range servers {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("castor: graceful shutdown error on %s: %v", srv.Addr, err)
			_ = srv.Close()
		}
	}
	log.Printf("castor: stopped")
	return nil
}

// resolveTLSMode returns the TLS mode to start with and whether the
// environment forces it (tlsmgr.ResolveMode): CASTOR_TLS_MODE=off wins over
// everything, otherwise the persisted tls.mode (self-signed, custom or acme)
// wins over the env default.
func resolveTLSMode(ctx context.Context, cfg *config.Config, st *store.Store) (string, bool) {
	persisted := strings.ToLower(strings.TrimSpace(st.GetSettingDefault(ctx, store.SettingTLSMode, "")))
	mode, managedByEnv := tlsmgr.ResolveMode(cfg.TLSMode, persisted)
	switch {
	case managedByEnv && persisted != "" && persisted != mode:
		log.Printf("castor: tls: CASTOR_TLS_MODE=off forces TLS off; the persisted tls.mode %q is ignored", persisted)
	case persisted != "" && persisted != mode:
		log.Printf("castor: tls: ignoring persisted tls.mode %q (only self-signed, custom or acme apply), using %q", persisted, mode)
	case persisted != "" && mode != cfg.TLSMode:
		log.Printf("castor: tls: persisted tls.mode %q overrides CASTOR_TLS_MODE %q", mode, cfg.TLSMode)
	}
	return mode, managedByEnv
}

// loadPersistedTLS installs the imported certificate (if any) and, in ACME
// mode, the persisted ACME parameters. Failures are logged and never fatal:
// the manager keeps serving the self-signed fallback so the UI stays reachable
// to fix the configuration. The sealed key is opened here, the composition
// point holding the secret key; neither the store nor tlsmgr sees it at rest.
func loadPersistedTLS(ctx context.Context, cfg *config.Config, st *store.Store, m *tlsmgr.Manager, mode string) {
	row, err := st.GetTLSCertificate(ctx)
	switch {
	case err == nil:
		keyPEM, err := authz.OpenSecret(cfg.SecretKey, row.KeyEnc)
		if err != nil {
			log.Printf("castor: tls: cannot open the stored certificate key (CASTOR_SECRET_KEY changed?); re-import the certificate: %v", err)
		} else if _, err := m.SetCustom([]byte(row.CertPEM), []byte(row.ChainPEM), keyPEM); err != nil {
			log.Printf("castor: tls: stored custom certificate rejected, falling back to self-signed: %v", err)
		}
	case !errors.Is(err, store.ErrNotFound):
		log.Printf("castor: tls: cannot read the stored certificate: %v", err)
	}

	if mode != config.TLSModeACME {
		return
	}
	domains := store.ParseTLSDomains(st.GetSettingDefault(ctx, store.SettingTLSACMEDomains, ""))
	if len(domains) == 0 {
		log.Printf("castor: tls: acme mode without domains (tls.acme.domains); serving the self-signed certificate until configured")
		return
	}
	email := st.GetSettingDefault(ctx, store.SettingTLSACMEEmail, "")
	staging := st.GetSettingDefault(ctx, store.SettingTLSACMEStaging, "false") == "true"
	if err := m.SetACME(domains, email, staging); err != nil {
		log.Printf("castor: tls: persisted acme settings rejected, serving the self-signed certificate: %v", err)
	}
}

// displayURL turns a listen address into a browsable URL for the startup log,
// substituting localhost for wildcard hosts.
func displayURL(scheme, addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return scheme + "://" + addr + "/"
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		return scheme + "://" + host + "/"
	}
	return scheme + "://" + host + ":" + port + "/"
}

// runSessionGC periodically prunes expired sessions and expired OIDC auth-states
// (the short-lived CSRF/PKCE rows from migration 0003). Both are housekeeping for
// rows whose absolute expiry has passed; piggybacking the OIDC-state sweep on the
// hourly session sweep avoids a second goroutine. ConsumeOIDCAuthState already
// deletes a state on use, so this only reaps abandoned (never-completed) flows.
func runSessionGC(ctx context.Context, st *store.Store) {
	t := time.NewTicker(1 * time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			gcCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			if n, err := st.DeleteExpiredSessions(gcCtx); err == nil && n > 0 {
				log.Printf("castor: pruned %d expired sessions", n)
			}
			if n, err := st.DeleteExpiredOIDCAuthStates(gcCtx); err == nil && n > 0 {
				log.Printf("castor: pruned %d expired OIDC auth-states", n)
			}
			cancel()
		}
	}
}

func short(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
