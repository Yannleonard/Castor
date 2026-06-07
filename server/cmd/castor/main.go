// Command castor is the single-binary Castor server: it serves the JSON API and
// the embedded React UI on one port, talking to the local Docker engine over the
// mounted socket and (optionally) Swarm and a mounted kubeconfig.
//
// Wiring order: config -> DB (migrate + seed) -> secret-key check -> providers
// -> registry -> cache (poller + watcher) -> authz -> router -> http.Server,
// then a graceful shutdown on SIGINT/SIGTERM.
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
	"github.com/gtek-it/castor/server/internal/cache"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/provider"
	"github.com/gtek-it/castor/server/internal/provider/docker"
	"github.com/gtek-it/castor/server/internal/provider/kube"
	"github.com/gtek-it/castor/server/internal/provider/swarm"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/version"
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

	if err := run(); err != nil {
		log.Fatalf("castor: fatal: %v", err)
	}
}

// runHealthcheck performs a GET against the locally-listening server's
// /api/v1/healthz and returns a process exit code: 0 when the endpoint answers
// 2xx, 1 otherwise. It reads CASTOR_HTTP_ADDR (default ":8080") to find the
// port and always dials the loopback interface (the listen addr may be an
// unspecified/wildcard host like ":8080" or "0.0.0.0:8080").
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

	// 5. Authz dependencies + destructive-action guard.
	azDeps := &authz.Deps{
		Store:              st,
		TrustProxy:         cfg.TrustProxy,
		AllowedOrigins:     cfg.AllowedOrigins,
		SecretKey:          cfg.SecretKey,
		AdminRoleID:        store.RoleIDAdmin,
		SessionTTL:         cfg.SessionTTL,
		SessionAbsoluteTTL: cfg.SessionAbsoluteTTL,
	}
	guard := authz.NewGuard(st, selfID, selfResolved)

	// 6. API server + router (REST + WS + embedded UI).
	apiServer := api.NewServer(cfg, st, azDeps, guard, mgr, reg)
	handler := apiServer.Router()

	// 7. HTTP server with sane timeouts.
	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handler,
		ReadHeaderTimeout: 15 * time.Second,
		// No WriteTimeout: long-lived WebSocket/stream responses use it; the WS
		// handler manages its own per-frame deadlines.
		IdleTimeout: 120 * time.Second,
	}

	// Background session housekeeping.
	go runSessionGC(rootCtx, st)

	errCh := make(chan error, 1)
	go func() {
		log.Printf("castor: listening on %s", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case <-rootCtx.Done():
		log.Printf("castor: shutdown signal received")
	case err := <-errCh:
		return err
	}

	// 8. Graceful shutdown.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("castor: graceful shutdown error: %v", err)
		_ = srv.Close()
	}
	log.Printf("castor: stopped")
	return nil
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
