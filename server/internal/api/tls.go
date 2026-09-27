package api

// tls.go is the Settings > HTTPS surface: it reports the certificate Castor
// serves, switches the TLS mode, imports/removes an operator certificate and
// (re)requests an ACME certificate, all through the runtime TLS manager
// (tlsmgr) so changes apply without a restart. The private key of an imported
// certificate is sealed here (authz.SealSecret, like registry credentials)
// before it reaches the store, and it is never returned, logged or audited.
//
// Rules shared with main.go and the UI: CASTOR_TLS_MODE=off owns the mode
// (every change is refused with tls_managed_by_env); "off" is never accepted
// from the API; while Castor terminates TLS itself, changes travel over HTTPS
// only; ACME needs the HTTPS listener that is bound at startup.

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/tlsmgr"
)

// tlsImportMaxBody caps the certificate import body (leaf + chain + key as
// PEM inside the JSON envelope). tlsmgr.MaxPEMBytes bounds each part at 64 KiB.
const tlsImportMaxBody = 256 << 10

// acmeRenewWait bounds how long RenewACME waits for the issuance before
// answering 202 with the still-pending status.
const acmeRenewWait = 20 * time.Second

// acmeRenewPoll is the Status polling interval of waitACME.
const acmeRenewPoll = 250 * time.Millisecond

// msgTLSRequiresHTTPS is the 403 sent to a TLS mutation that arrived on the
// plain-HTTP listener while the HTTPS listener is on.
const msgTLSRequiresHTTPS = "Certificate management requires an HTTPS connection."

// tlsSettingsView is the read model of GET /settings/tls and the body of every
// TLS mutation. It carries public material only: certificate metadata, never a
// key.
type tlsSettingsView struct {
	// Mode is the configured mode (persisted tls.mode, else the env default).
	Mode string `json:"mode"`
	// EffectiveMode is what handshakes actually use: "self-signed" when the
	// configured source has no usable certificate yet, "off" without HTTPS.
	EffectiveMode string `json:"effectiveMode"`
	// ManagedByEnv is true when CASTOR_TLS_MODE=off forces the mode; every
	// mutation is then refused (409 tls_managed_by_env).
	ManagedByEnv bool `json:"managedByEnv"`
	// Serving is true when the HTTPS listener is active.
	Serving   bool   `json:"serving"`
	HTTPSAddr string `json:"httpsAddr"`
	HTTPAddr  string `json:"httpAddr"`
	// Redirect is true when the plain-HTTP listener redirects to HTTPS.
	Redirect bool `json:"redirect"`
	// PublicHTTPSURL is the HTTPS origin the redirect sends this request's Host
	// to (same rule: host without a port or on port 80 -> https://host,
	// otherwise the HTTPS listen port), the URL to advertise to operators.
	PublicHTTPSURL string `json:"publicHttpsUrl"`
	// HSTS is true when Strict-Transport-Security is currently sent.
	HSTS bool `json:"hsts"`
	// RestartRequired is true when the configured mode toggles the HTTPS
	// listener relative to what was bound at startup (off <-> on).
	RestartRequired bool `json:"restartRequired"`
	// Certificate is what visitors currently get; null when TLS is off.
	Certificate *tlsmgr.CertInfo `json:"certificate"`
	// Custom describes the imported certificate whatever the active mode, so the
	// UI can show what "custom" would serve; null when none is installed.
	Custom               *tlsmgr.CertInfo `json:"custom"`
	HasCustomCertificate bool             `json:"hasCustomCertificate"`
	ACME                 tlsACMEView      `json:"acme"`
}

// tlsACMEView is the ACME configuration (persisted settings) plus the outcome
// of the last issuance when the manager has an ACME configuration applied.
type tlsACMEView struct {
	Domains []string `json:"domains"`
	Email   string   `json:"email"`
	Staging bool     `json:"staging"`
	// Ready is true once a certificate was obtained for this configuration.
	Ready       bool   `json:"ready"`
	LastError   string `json:"lastError"`
	LastErrorAt int64  `json:"lastErrorAt,omitempty"`
	// LastIssued is the validity start of the served ACME certificate; it only
	// changes when that certificate does.
	LastIssued int64 `json:"lastIssued,omitempty"`
}

// tlsACMERequest is the ACME block of PUT /settings/tls.
type tlsACMERequest struct {
	Domains []string `json:"domains"`
	Email   string   `json:"email"`
	Staging bool     `json:"staging"`
}

type updateTLSRequest struct {
	Mode string `json:"mode"`
	// ACME is applied (validated, persisted, installed) only when Mode is
	// "acme"; omitted there, the persisted ACME settings are reused.
	ACME *tlsACMERequest `json:"acme"`
}

type importTLSCertificateRequest struct {
	CertPEM  string `json:"certPem"`
	KeyPEM   string `json:"keyPem"`
	ChainPEM string `json:"chainPem"`
}

// tlsManager returns the wired TLS manager, or a 409 when Castor runs without
// one (only the case when the server was built without SetTLSManager, e.g. in
// tests): there is then nothing to configure.
func (s *Server) tlsManager() (*tlsmgr.Manager, error) {
	if s.tls == nil {
		return nil, authz.Errorf(authz.ErrConflict, "TLS is not managed by this Castor instance.")
	}
	return s.tls, nil
}

// tlsMutable is tlsManager for a mutation. It refuses the change when the
// environment owns the mode (CASTOR_TLS_MODE=off: 409 tls_managed_by_env) and
// when the request did not arrive over HTTPS while Castor terminates TLS
// itself (403): key material and mode switches only travel encrypted. With the
// HTTPS listener off (effective mode "off": a TLS-terminating proxy in front,
// or no listener at all) the plain listener is the only one, so that check
// does not apply.
func (s *Server) tlsMutable(r *http.Request) (*tlsmgr.Manager, error) {
	m, err := s.tlsManager()
	if err != nil {
		return nil, err
	}
	if m.ManagedByEnv() {
		return nil, authz.ErrTLSManagedByEnv
	}
	if m.EffectiveMode() != config.TLSModeOff && !authz.IsHTTPS(r, s.cfg.TrustProxy) {
		return nil, authz.Errorf(authz.ErrForbidden, msgTLSRequiresHTTPS)
	}
	return m, nil
}

// persistedACME reads the ACME settings rows (domains, email, staging).
func (s *Server) persistedACME(ctx context.Context) (domains []string, email string, staging bool) {
	domains = store.ParseTLSDomains(s.store.GetSettingDefault(ctx, store.SettingTLSACMEDomains, ""))
	email = s.store.GetSettingDefault(ctx, store.SettingTLSACMEEmail, "")
	staging = s.store.GetSettingDefault(ctx, store.SettingTLSACMEStaging, "false") == "true"
	return domains, email, staging
}

// tlsView builds the read model from the manager status and the persisted ACME
// settings; the request supplies the Host the public HTTPS URL is derived
// from. Without a manager it reports TLS off.
func (s *Server) tlsView(r *http.Request) tlsSettingsView {
	ctx := r.Context()
	domains, email, staging := s.persistedACME(ctx)
	if domains == nil {
		domains = []string{}
	}
	v := tlsSettingsView{
		Mode:           config.TLSModeOff,
		EffectiveMode:  config.TLSModeOff,
		HTTPSAddr:      s.cfg.HTTPSAddr,
		HTTPAddr:       s.cfg.HTTPAddr,
		PublicHTTPSURL: tlsmgr.PublicHTTPSURL(s.cfg.HTTPSAddr, r.Host),
		ACME:           tlsACMEView{Domains: domains, Email: email, Staging: staging},
	}
	if s.tls == nil {
		return v
	}
	st := s.tls.Status()
	v.Mode = st.Mode
	v.EffectiveMode = st.EffectiveMode
	v.ManagedByEnv = st.ManagedByEnv
	v.Serving = st.Serving
	v.Redirect = s.cfg.HTTPRedirect && st.Serving
	v.PublicHTTPSURL = s.tls.PublicHTTPSURL(r.Host)
	v.HSTS = st.HSTS
	v.RestartRequired = st.RestartRequired
	v.Certificate = st.Certificate
	v.Custom = st.Custom
	v.HasCustomCertificate = st.Custom != nil
	if a := st.ACME; a != nil {
		// The applied configuration is authoritative over the rows (they are
		// written together, but the manager also reports issuance state).
		v.ACME = tlsACMEView{
			Domains:     append([]string{}, a.Domains...),
			Email:       a.Email,
			Staging:     a.Staging,
			Ready:       a.Ready,
			LastError:   a.LastError,
			LastErrorAt: a.LastErrorAt,
			LastIssued:  a.LastIssued,
		}
	}
	return v
}

// GetTLSSettings returns the TLS mode, the served certificate and the ACME
// state (perm settings.read). Never any key material.
func (s *Server) GetTLSSettings(w http.ResponseWriter, r *http.Request) {
	ok(w, s.tlsView(r))
}

// UpdateTLSSettings switches the TLS mode (perm settings.update) among
// self-signed, custom and acme; "off" is refused (422), TLS is only turned off
// from the environment. "custom" requires an imported certificate (409
// otherwise); "acme" requires the HTTPS listener (409 tls_https_off), then
// validates and applies the ACME block (or the persisted ACME settings when
// omitted) and starts the issuance in the background. The mode is persisted
// (tls.mode) and applied to the running listener at once.
func (s *Server) UpdateTLSSettings(w http.ResponseWriter, r *http.Request) {
	m, err := s.tlsMutable(r)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	var req updateTLSRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == config.TLSModeOff || !config.IsValidTLSMode(mode) {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation,
			"mode must be one of self-signed, custom, acme; HTTPS is turned off with CASTOR_TLS_MODE=off and a restart."))
		return
	}
	ctx := r.Context()
	authz.SetAuditTarget(r, "tls", "settings", mode)
	authz.AddAuditDetail(r, "mode", mode)

	switch mode {
	case config.TLSModeCustom:
		if m.Status().Custom == nil {
			if _, err := s.store.GetTLSCertificate(ctx); err == nil {
				// A row exists but the manager could not load it at startup
				// (secret key changed, certificate expired since).
				authz.WriteError(w, r, authz.Errorf(authz.ErrTLSNoCustomCertificate,
					"The stored certificate could not be loaded; import it again before selecting the custom mode."))
				return
			}
			authz.WriteError(w, r, authz.ErrTLSNoCustomCertificate)
			return
		}
	case config.TLSModeACME:
		// Without the HTTPS listener no certificate could be served and the
		// TLS-ALPN-01 challenge cannot be answered: refuse before autocert is
		// touched, so no CA order (and no rate-limit quota) is spent.
		if !m.Serving() {
			authz.WriteError(w, r, authz.ErrTLSHTTPSOff)
			return
		}
		domains, email, staging := s.persistedACME(ctx)
		if req.ACME != nil {
			domains, email, staging = req.ACME.Domains, strings.TrimSpace(req.ACME.Email), req.ACME.Staging
		}
		// SetACME validates (hostnames, no wildcard/IP, email) before installing
		// anything, so a rejected block leaves both the manager and the rows as
		// they were.
		if err := m.SetACME(domains, email, staging); err != nil {
			writeMapped(w, r, err)
			return
		}
		if err := s.store.SetSetting(ctx, store.SettingTLSACMEDomains, store.FormatTLSDomains(domains)); err != nil {
			writeMapped(w, r, err)
			return
		}
		if err := s.store.SetSetting(ctx, store.SettingTLSACMEEmail, email); err != nil {
			writeMapped(w, r, err)
			return
		}
		if err := s.store.SetSetting(ctx, store.SettingTLSACMEStaging, strconv.FormatBool(staging)); err != nil {
			writeMapped(w, r, err)
			return
		}
		authz.AddAuditDetail(r, "acmeDomains", store.FormatTLSDomains(domains))
		authz.AddAuditDetail(r, "acmeStaging", staging)
	}

	if err := s.store.SetSetting(ctx, store.SettingTLSMode, mode); err != nil {
		writeMapped(w, r, err)
		return
	}
	if err := m.SetMode(mode); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, s.tlsView(r))
}

// ImportTLSCertificate installs an operator certificate (perm settings.update):
// PEM leaf, optional PEM chain and the unencrypted PEM private key. The input
// is validated by tlsmgr.ParseCustom (key/leaf match, validity window, RSA >=
// 2048 or ECDSA, size, chain linking to the leaf, no private key in a
// certificate field), installed for serving, then stored with the key sealed
// under the secret key, and the mode switches to "custom". What is persisted
// is the parsed material re-serialized as CERTIFICATE blocks (leaf in
// cert_pem, intermediates in chain_pem), never the raw input. The audit target
// is the leaf fingerprint; the key never reaches the audit row, the log or the
// reply.
func (s *Server) ImportTLSCertificate(w http.ResponseWriter, r *http.Request) {
	m, err := s.tlsMutable(r)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	// Tighter cap than decodeJSON's 1 MiB: three PEM blobs of at most 64 KiB.
	r.Body = http.MaxBytesReader(w, r.Body, tlsImportMaxBody)
	var req importTLSCertificateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()

	// Validate before anything is installed or sealed. A rejected input leaves
	// the manager untouched and maps to 422 (tls_key_mismatch /
	// tls_certificate_expired / tls_invalid_certificate).
	parsed, err := tlsmgr.ParseCustom([]byte(req.CertPEM), []byte(req.ChainPEM), []byte(req.KeyPEM), time.Now())
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	leafPEM, chainPEM := tlsmgr.EncodeChainPEM(parsed)
	// Seal is pure, so a (theoretical) failure changes nothing.
	sealed, err := authz.SealSecret(s.cfg.SecretKey, []byte(req.KeyPEM))
	if err != nil {
		authz.WriteError(w, r, authz.ErrInternal)
		return
	}
	// Install: the manager re-runs the same validation on the same bytes.
	info, err := m.SetCustom([]byte(req.CertPEM), []byte(req.ChainPEM), []byte(req.KeyPEM))
	if err != nil {
		writeMapped(w, r, err)
		return
	}
	authz.SetAuditTarget(r, "tls_certificate", info.FingerprintSHA256, info.Subject)
	authz.AddAuditDetail(r, "issuer", info.Issuer)
	authz.AddAuditDetail(r, "notAfter", info.NotAfter)

	// Persist. Should this write fail the manager keeps serving the (valid)
	// certificate just installed until the next restart reloads the stored one;
	// the operator sees the 500 and can retry.
	row := &store.TLSCertificate{
		CertPEM:           string(leafPEM),
		ChainPEM:          string(chainPEM),
		KeyEnc:            sealed,
		Subject:           info.Subject,
		Issuer:            info.Issuer,
		NotBefore:         info.NotBefore,
		NotAfter:          info.NotAfter,
		FingerprintSHA256: info.FingerprintSHA256,
	}
	if err := s.store.UpsertTLSCertificate(ctx, row); err != nil {
		writeMapped(w, r, err)
		return
	}
	if err := s.store.SetSetting(ctx, store.SettingTLSMode, config.TLSModeCustom); err != nil {
		writeMapped(w, r, err)
		return
	}
	if err := m.SetMode(config.TLSModeCustom); err != nil {
		writeMapped(w, r, err)
		return
	}
	ok(w, s.tlsView(r))
}

// RemoveTLSCertificate deletes the imported certificate (perm settings.update)
// and, when it was being served, falls back to the self-signed mode. 404 when
// there is nothing to remove.
func (s *Server) RemoveTLSCertificate(w http.ResponseWriter, r *http.Request) {
	m, err := s.tlsMutable(r)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	st := m.Status()
	err = s.store.DeleteTLSCertificate(ctx)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		writeMapped(w, r, err)
		return
	}
	if errors.Is(err, store.ErrNotFound) && st.Custom == nil {
		writeMapped(w, r, err)
		return
	}
	if st.Custom != nil {
		authz.SetAuditTarget(r, "tls_certificate", st.Custom.FingerprintSHA256, st.Custom.Subject)
	}
	m.ClearCustom()
	if st.Mode == config.TLSModeCustom {
		if err := s.store.SetSetting(ctx, store.SettingTLSMode, config.TLSModeSelfSigned); err != nil {
			writeMapped(w, r, err)
			return
		}
		if err := m.SetMode(config.TLSModeSelfSigned); err != nil {
			writeMapped(w, r, err)
			return
		}
		authz.AddAuditDetail(r, "mode", config.TLSModeSelfSigned)
	}
	ok(w, s.tlsView(r))
}

// DownloadTLSCertificate streams the PEM chain of the certificate currently
// served (perm settings.read) as an attachment, so the self-signed certificate
// can be added to a trust store. Public material only. 404 when TLS is off.
func (s *Server) DownloadTLSCertificate(w http.ResponseWriter, r *http.Request) {
	var pemBytes []byte
	if s.tls != nil {
		pemBytes = s.tls.CurrentCertPEM()
	}
	if len(pemBytes) == 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrNotFound, "No certificate is being served: TLS is off."))
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/x-pem-file")
	h.Set("Content-Disposition", `attachment; filename="castor.crt"`)
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pemBytes)
}

// RenewACME forces a fresh issuance for every configured domain (perm
// settings.update): the manager drops its cached certificates and obtains new
// ones (tlsmgr.Manager.Renew), visitors keeping the current ones meanwhile. It
// waits up to acmeRenewWait for the outcome: 200 with the new status once the
// certificates are ready, 502 acme_error with the CA/DNS message when the
// request failed, 202 with the pending status when the CA has not answered
// yet (the issuance keeps running in the background and GET /settings/tls
// reports its result). When no ACME configuration is applied yet (it was
// rejected at startup, or the mode was just switched), the persisted settings
// are applied first, which is the same first issuance.
func (s *Server) RenewACME(w http.ResponseWriter, r *http.Request) {
	m, err := s.tlsMutable(r)
	if err != nil {
		authz.WriteError(w, r, err)
		return
	}
	ctx := r.Context()
	if m.Mode() != config.TLSModeACME {
		authz.WriteError(w, r, authz.Errorf(authz.ErrConflict, "The TLS mode is not acme; select the acme mode first."))
		return
	}
	domains, email, staging := s.persistedACME(ctx)
	if len(domains) == 0 {
		authz.WriteError(w, r, authz.Errorf(authz.ErrValidation, "No ACME domain is configured."))
		return
	}
	authz.SetAuditTarget(r, "tls", "acme", strings.Join(domains, ","))
	authz.AddAuditDetail(r, "acmeStaging", staging)

	if m.Status().ACME == nil {
		if err := m.SetACME(domains, email, staging); err != nil {
			writeMapped(w, r, err)
			return
		}
		ready, lastErr := waitACME(ctx, m, acmeRenewWait)
		switch {
		case ready:
			ok(w, s.tlsView(r))
		case lastErr != "":
			authz.WriteError(w, r, acmeError(lastErr))
		default:
			authz.WriteJSON(w, http.StatusAccepted, s.tlsView(r))
		}
		return
	}

	wctx, cancel := context.WithTimeout(ctx, acmeRenewWait)
	defer cancel()
	switch err := m.Renew(wctx); {
	case err == nil:
		ok(w, s.tlsView(r))
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		// Still running in the background; Status reports the outcome.
		authz.WriteJSON(w, http.StatusAccepted, s.tlsView(r))
	case errors.Is(err, tlsmgr.ErrInvalidACMEConfig):
		writeMapped(w, r, err)
	default:
		authz.WriteError(w, r, acmeError(err.Error()))
	}
}

// acmeError builds the 502 acme_error carrying the CA/DNS explanation, which
// is operator-facing and never contains key material.
func acmeError(detail string) *authz.APIError {
	return authz.Errorf(authz.ErrACME, strings.TrimSuffix(authz.ErrACME.Message, ".")+": "+detail)
}

// waitACME polls the manager until the current ACME configuration reports a
// certificate or an error, or until wait elapses / ctx ends. It returns the
// readiness flag and the last error message (empty when none yet).
func waitACME(ctx context.Context, m *tlsmgr.Manager, wait time.Duration) (ready bool, lastErr string) {
	deadline := time.Now().Add(wait)
	for {
		st := m.Status()
		if a := st.ACME; a != nil {
			if a.Ready {
				return true, ""
			}
			if a.LastError != "" {
				return false, a.LastError
			}
		}
		if time.Now().After(deadline) {
			return false, ""
		}
		select {
		case <-ctx.Done():
			return false, ""
		case <-time.After(acmeRenewPoll):
		}
	}
}
