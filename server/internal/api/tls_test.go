package api

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gtek-it/castor/server/internal/authz"
	"github.com/gtek-it/castor/server/internal/config"
	"github.com/gtek-it/castor/server/internal/store"
	"github.com/gtek-it/castor/server/internal/tlsmgr"
)

// withTLSManager wires a self-signed TLS manager into the test server (no
// listener is started; the manager only generates the fallback certificate in
// a temp dir) so the Settings > HTTPS handlers exercise the real hot reload.
func withTLSManager(t *testing.T, e *testEnv) *tlsmgr.Manager {
	t.Helper()
	return withTLSManagerMode(t, e, config.TLSModeSelfSigned, false)
}

// withTLSManagerMode is withTLSManager for an explicit startup mode ("off"
// means no HTTPS listener) and the CASTOR_TLS_MODE=off flag.
func withTLSManagerMode(t *testing.T, e *testEnv, mode string, managedByEnv bool) *tlsmgr.Manager {
	t.Helper()
	m, err := tlsmgr.New(tlsmgr.Options{
		Dir:          filepath.Join(t.TempDir(), "tls"),
		Mode:         mode,
		ManagedByEnv: managedByEnv,
		HTTPSAddr:    ":8443",
		Logf:         t.Logf,
	})
	if err != nil {
		t.Fatalf("tlsmgr.New: %v", err)
	}
	e.srv.SetTLSManager(m)
	return m
}

// tlsRequest is e.do with control over the transport: https marks the request
// as received on the TLS listener (what every TLS mutation requires), host
// overrides the Host header (the public HTTPS URL derives from it) and hdr
// adds headers (X-Forwarded-Proto for the trusted-proxy case). The Origin
// follows the scheme and host so the CSRF check passes.
func (e *testEnv) tlsRequest(t *testing.T, method, path string, body any, cookies []*http.Cookie, csrf string, https bool, host string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	if host == "" {
		host = "example.test"
	}
	scheme := "http"
	if https {
		scheme = "https"
		req.TLS = &tls.ConnectionState{}
	}
	req.Host = host
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", scheme+"://"+host)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	if csrf != "" {
		req.Header.Set(authz.CSRFHeaderName, csrf)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	return rec
}

// doHTTPS is e.do over the HTTPS listener.
func (e *testEnv) doHTTPS(t *testing.T, method, path string, body any, cookies []*http.Cookie, csrf string) *httptest.ResponseRecorder {
	t.Helper()
	return e.tlsRequest(t, method, path, body, cookies, csrf, true, "", nil)
}

// mintCertificate signs tmpl with parentKey under parent (self-signed when
// parent is nil) for the public key pub. It returns the PEM and DER forms and
// the parsed certificate.
func mintCertificate(t *testing.T, tmpl *x509.Certificate, parent *x509.Certificate, pub any, parentKey crypto.Signer) (certPEM, der []byte, parsed *x509.Certificate) {
	t.Helper()
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 64))
	tmpl.SerialNumber = serial
	if parent == nil {
		parent = tmpl
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, parentKey)
	if err != nil {
		t.Fatalf("CreateCertificate: %v", err)
	}
	parsed, err = x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("ParseCertificate: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), der, parsed
}

// serverTemplate is the template of a server certificate for cn.
func serverTemplate(cn string, notBefore, notAfter time.Time) *x509.Certificate {
	return &x509.Certificate{
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{cn},
	}
}

// pemPrivateKey returns key as a PEM PKCS#8 block.
func pemPrivateKey(t *testing.T, key crypto.Signer) []byte {
	t.Helper()
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
}

// testCertificate mints a self-signed server certificate for cn, valid over
// [notBefore, notAfter], signed with key (ECDSA or RSA). It returns the PEM
// certificate, the PEM (PKCS#8) private key and the DER leaf.
func testCertificate(t *testing.T, cn string, key crypto.Signer, notBefore, notAfter time.Time) (certPEM, keyPEM, der []byte) {
	t.Helper()
	certPEM, der, _ = mintCertificate(t, serverTemplate(cn, notBefore, notAfter), nil, key.Public(), key)
	return certPEM, pemPrivateKey(t, key), der
}

// testCA mints a self-signed (or, with parent, subordinate) CA certificate.
func testCA(t *testing.T, cn string, key crypto.Signer, parent *x509.Certificate, parentKey crypto.Signer, notBefore, notAfter time.Time) (caPEM []byte, ca *x509.Certificate) {
	t.Helper()
	tmpl := &x509.Certificate{
		Subject:               pkix.Name{CommonName: cn},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	if parent == nil {
		parentKey = key
	}
	caPEM, _, ca = mintCertificate(t, tmpl, parent, key.Public(), parentKey)
	return caPEM, ca
}

// testIssuedCertificate mints a server certificate for cn signed by ca.
func testIssuedCertificate(t *testing.T, cn string, key crypto.Signer, ca *x509.Certificate, caKey crypto.Signer, notBefore, notAfter time.Time) (certPEM, keyPEM []byte) {
	t.Helper()
	certPEM, _, _ = mintCertificate(t, serverTemplate(cn, notBefore, notAfter), ca, key.Public(), caKey)
	return certPEM, pemPrivateKey(t, key)
}

func testECKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// keyBody returns the base64 payload of a PEM key: the string that must never
// appear in a response, a log line, an audit row or a certificate column.
func keyBody(keyPEM []byte) string {
	blk, _ := pem.Decode(keyPEM)
	return base64.StdEncoding.EncodeToString(blk.Bytes)
}

// parseTestKey parses a PEM private key in any of the accepted encodings.
func parseTestKey(t *testing.T, keyPEM []byte) crypto.Signer {
	t.Helper()
	blk, _ := pem.Decode(keyPEM)
	if blk == nil {
		t.Fatalf("no PEM block in key")
	}
	var (
		k   any
		err error
	)
	switch blk.Type {
	case "RSA PRIVATE KEY":
		k, err = x509.ParsePKCS1PrivateKey(blk.Bytes)
	case "EC PRIVATE KEY":
		k, err = x509.ParseECPrivateKey(blk.Bytes)
	default:
		k, err = x509.ParsePKCS8PrivateKey(blk.Bytes)
	}
	if err != nil {
		t.Fatalf("parse %s: %v", blk.Type, err)
	}
	return k.(crypto.Signer)
}

// sameKey reports whether two PEM private keys (whatever their encoding) hold
// the same key: what is sealed is the PKCS#8 re-serialization of the input.
func sameKey(t *testing.T, a, b []byte) bool {
	t.Helper()
	pa, pb := parseTestKey(t, a).Public(), parseTestKey(t, b).Public()
	return pa.(interface{ Equal(crypto.PublicKey) bool }).Equal(pb)
}

// fingerprintPrefix formats the first 8 bytes of a key identifier the way the
// import messages do (upper-case hex pairs, colon separated).
func fingerprintPrefix(id []byte) string {
	h := strings.ToUpper(hex.EncodeToString(id[:8]))
	parts := make([]string, 0, 8)
	for i := 0; i+2 <= len(h); i += 2 {
		parts = append(parts, h[i:i+2])
	}
	return strings.Join(parts, ":")
}

// misSignedCertificate mints the classic mistake behind most import failures:
// a certificate naming ca as its issuer but signed with its own key, so its
// Authority Key Identifier is its own Subject Key Identifier.
func misSignedCertificate(t *testing.T, cn string, key crypto.Signer, ca *x509.Certificate, notBefore, notAfter time.Time) (certPEM, keyPEM []byte) {
	t.Helper()
	ski := []byte{0xAF, 0xCA, 0x29, 0xFE, 0xAD, 0x5E, 0x8A, 0x89, 0x55, 0x85, 0x11, 0x28, 0x34, 0x0A, 0xA5, 0x25, 0xCC, 0xB1, 0xC3, 0x9E}
	tmpl := serverTemplate(cn, notBefore, notAfter)
	tmpl.SubjectKeyId = ski
	fakeParent := &x509.Certificate{RawSubject: ca.RawSubject, SubjectKeyId: ski}
	certPEM, _, _ = mintCertificate(t, tmpl, fakeParent, key.Public(), key)
	return certPEM, pemPrivateKey(t, key)
}

// tlsErrorCode fetches error.code from an envelope body.
func tlsErrorCode(t *testing.T, body map[string]any) string {
	t.Helper()
	errObj, _ := body["error"].(map[string]any)
	code, _ := errObj["code"].(string)
	return code
}

// tlsErrorMessage fetches error.message from an envelope body.
func tlsErrorMessage(t *testing.T, body map[string]any) string {
	t.Helper()
	errObj, _ := body["error"].(map[string]any)
	msg, _ := errObj["message"].(string)
	return msg
}

// TestTLSImportCertificateLifecycle covers import -> served -> download ->
// remove: a valid pair switches the mode to custom and is served at once, the
// key is sealed at rest and absent from every response and the audit trail, the
// PEM download is the public certificate, and removal falls back to
// self-signed.
func TestTLSImportCertificateLifecycle(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)

	// Initial status: self-signed, no custom certificate, SANs cover localhost.
	rec := e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET tls code = %d (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["mode"] != config.TLSModeSelfSigned || body["effectiveMode"] != config.TLSModeSelfSigned || body["hasCustomCertificate"] != false {
		t.Errorf("initial status = %v", body)
	}
	if body["serving"] != true || body["managedByEnv"] != false || body["hsts"] != false {
		t.Errorf("initial serving/managedByEnv/hsts = %v/%v/%v", body["serving"], body["managedByEnv"], body["hsts"])
	}
	cert, _ := body["certificate"].(map[string]any)
	if cert == nil || cert["source"] != config.TLSModeSelfSigned || cert["subject"] != "CN=Castor" || cert["expired"] != false {
		t.Errorf("initial certificate = %v", cert)
	}
	sans, _ := cert["sans"].([]any)
	foundLocalhost := false
	for _, s := range sans {
		if s == "localhost" {
			foundLocalhost = true
		}
	}
	if !foundLocalhost {
		t.Errorf("self-signed SANs %v must include localhost", sans)
	}
	acme, _ := body["acme"].(map[string]any)
	if acme == nil || acme["domains"] == nil {
		t.Errorf("acme block must always be present with a domains array: %v", body["acme"])
	}

	// Import a valid pair.
	now := time.Now()
	key := testECKey(t)
	certPEM, keyPEM, der := testCertificate(t, "imported.example.test", key, now.Add(-time.Hour), now.Add(90*24*time.Hour))
	secret := keyBody(keyPEM)
	rec = e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{
		"certPem": string(certPEM), "keyPem": string(keyPEM),
	}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("import code = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "PRIVATE KEY") || strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("import response leaked key material")
	}
	body = decodeBody(t, rec)
	if body["mode"] != config.TLSModeCustom || body["effectiveMode"] != config.TLSModeCustom || body["hasCustomCertificate"] != true {
		t.Errorf("post-import status = %v", body)
	}
	if body["hsts"] != true {
		t.Errorf("hsts after importing a valid certificate = %v want true", body["hsts"])
	}
	cert, _ = body["certificate"].(map[string]any)
	if cert == nil || cert["source"] != config.TLSModeCustom || cert["subject"] != "CN=imported.example.test" || cert["expired"] != false {
		t.Errorf("post-import certificate = %v", cert)
	}
	// A self-signed certificate imported on purpose is accepted, and flagged so
	// the UI can warn that browsers will not trust it as is.
	if cert["selfSignedCustom"] != true {
		t.Errorf("certificate.selfSignedCustom = %v want true", cert["selfSignedCustom"])
	}
	fingerprint, _ := cert["fingerprintSha256"].(string)
	if fingerprint == "" {
		t.Fatalf("certificate.fingerprintSha256 missing")
	}
	if custom, _ := body["custom"].(map[string]any); custom == nil || custom["fingerprintSha256"] != fingerprint || custom["selfSignedCustom"] != true {
		t.Errorf("custom = %v want the imported fingerprint, selfSignedCustom true", body["custom"])
	}

	// GET reflects the same and still carries no key.
	rec = e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "")
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "PRIVATE KEY") || strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("GET after import: code=%d leak=%t", rec.Code, strings.Contains(rec.Body.String(), secret))
	}
	body = decodeBody(t, rec)
	if body["mode"] != config.TLSModeCustom {
		t.Errorf("GET mode after import = %v", body["mode"])
	}
	if cert, _ := body["certificate"].(map[string]any); cert == nil || cert["selfSignedCustom"] != true {
		t.Errorf("GET certificate after import = %v want selfSignedCustom true", body["certificate"])
	}

	// Hot reload: the manager now serves the imported leaf.
	if m.Mode() != config.TLSModeCustom {
		t.Errorf("manager mode = %q want custom", m.Mode())
	}
	served, err := m.GetCertificate(&tls.ClientHelloInfo{ServerName: "anything"})
	if err != nil || served.Leaf == nil || served.Leaf.Subject.CommonName != "imported.example.test" {
		t.Errorf("served certificate = %v, %v", served, err)
	}

	// At rest: sealed key (opens to the PEM), metadata, persisted mode.
	row, err := e.st.GetTLSCertificate(ctx)
	if err != nil {
		t.Fatalf("GetTLSCertificate: %v", err)
	}
	if string(row.KeyEnc) == string(keyPEM) || strings.Contains(string(row.KeyEnc), secret) {
		t.Fatalf("private key stored in clear")
	}
	if opened, err := authz.OpenSecret(e.srv.cfg.SecretKey, row.KeyEnc); err != nil || !sameKey(t, opened, keyPEM) {
		t.Errorf("sealed key does not open to the imported key: %v", err)
	}
	if row.FingerprintSHA256 != fingerprint || row.Subject != "CN=imported.example.test" || row.CertPEM != string(certPEM) || row.ChainPEM != "" {
		t.Errorf("stored row = %+v", row)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSMode, ""); got != config.TLSModeCustom {
		t.Errorf("persisted tls.mode = %q want custom", got)
	}

	// Audit: one success row targeting the fingerprint, no key anywhere.
	entries, _, err := e.st.ListAudit(ctx, store.AuditFilter{Action: "tls.certificate.import"})
	if err != nil {
		t.Fatalf("ListAudit: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("expected 1 tls.certificate.import audit row, got %d", len(entries))
	}
	a := entries[0]
	if a.Result != "success" || a.TargetType != "tls_certificate" || a.TargetID != fingerprint || a.TargetName != "CN=imported.example.test" {
		t.Errorf("audit row = %+v", a)
	}
	if strings.Contains(a.TargetID+a.TargetName+a.Detail, secret) || strings.Contains(a.Detail, "PRIVATE KEY") {
		t.Errorf("audit row leaked key material")
	}

	// Download: the public certificate only, as an attachment.
	rec = e.do(t, http.MethodGet, "/api/v1/settings/tls/certificate.pem", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("download code = %d (%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/x-pem-file" {
		t.Errorf("Content-Type = %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "attachment") || !strings.Contains(cd, "castor.crt") {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if strings.Contains(rec.Body.String(), "PRIVATE KEY") {
		t.Fatalf("download leaked key material")
	}
	blk, rest := pem.Decode(rec.Body.Bytes())
	if blk == nil || blk.Type != "CERTIFICATE" || len(strings.TrimSpace(string(rest))) != 0 {
		t.Fatalf("download is not a single CERTIFICATE PEM")
	}
	if string(blk.Bytes) != string(der) {
		t.Errorf("downloaded certificate differs from the imported leaf")
	}

	// Remove: back to self-signed, row gone, persisted mode updated.
	rec = e.doHTTPS(t, http.MethodDelete, "/api/v1/settings/tls/certificate", nil, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("remove code = %d (%s)", rec.Code, rec.Body.String())
	}
	body = decodeBody(t, rec)
	if body["mode"] != config.TLSModeSelfSigned || body["effectiveMode"] != config.TLSModeSelfSigned || body["hasCustomCertificate"] != false || body["custom"] != nil {
		t.Errorf("post-remove status = %v", body)
	}
	if body["hsts"] != false {
		t.Errorf("hsts after falling back to self-signed = %v want false", body["hsts"])
	}
	if _, err := e.st.GetTLSCertificate(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("row after remove err = %v want ErrNotFound", err)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSMode, ""); got != config.TLSModeSelfSigned {
		t.Errorf("persisted tls.mode after remove = %q", got)
	}
	served, _ = m.GetCertificate(&tls.ClientHelloInfo{})
	if served.Leaf == nil || served.Leaf.Subject.CommonName != "Castor" {
		t.Errorf("after remove the self-signed certificate must be served, got %v", served.Leaf)
	}
	entries, _, _ = e.st.ListAudit(ctx, store.AuditFilter{Action: "tls.certificate.remove"})
	if len(entries) != 1 || entries[0].TargetID != fingerprint || entries[0].Result != "success" {
		t.Errorf("remove audit rows = %+v", entries)
	}

	// Nothing left to remove.
	rec = e.doHTTPS(t, http.MethodDelete, "/api/v1/settings/tls/certificate", nil, cookies, csrf)
	if rec.Code != http.StatusNotFound {
		t.Errorf("second remove code = %d want 404", rec.Code)
	}
}

// TestTLSImportPersistsParsedMaterialOnly: what reaches tls_certificates is
// the parsed chain re-serialized as CERTIFICATE blocks, leaf in cert_pem and
// intermediates in chain_pem, whatever the operator pasted around them (a
// bundle in the certificate field, comments, a root in the chain field).
func TestTLSImportPersistsParsedMaterialOnly(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)
	now := time.Now()

	rootKey := testECKey(t)
	rootPEM, root := testCA(t, "Test Root", rootKey, nil, nil, now.Add(-2*time.Hour), now.Add(72*time.Hour))
	interKey := testECKey(t)
	interPEM, inter := testCA(t, "Test Intermediate", interKey, root, rootKey, now.Add(-time.Hour), now.Add(48*time.Hour))
	leafKey := testECKey(t)
	leafPEM, keyPEM := testIssuedCertificate(t, "chained.example.test", leafKey, inter, interKey, now.Add(-time.Hour), now.Add(24*time.Hour))

	bundle := "# fullchain.pem exported from the CA\n" + string(leafPEM) + "subject=CN=Test Intermediate\n" + string(interPEM)
	rec := e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{
		"certPem": bundle, "chainPem": "\n" + string(rootPEM) + "\n", "keyPem": string(keyPEM),
	}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("import code = %d (%s)", rec.Code, rec.Body.String())
	}
	if cert, _ := decodeBody(t, rec)["certificate"].(map[string]any); cert == nil || cert["selfSignedCustom"] != false {
		t.Errorf("a CA-issued certificate must not be flagged self-signed: %v", cert)
	}
	served, err := m.GetCertificate(&tls.ClientHelloInfo{})
	if err != nil || len(served.Certificate) != 3 || served.Leaf == nil || served.Leaf.Subject.CommonName != "chained.example.test" {
		t.Errorf("served chain = %d certificates, leaf %v, err %v", len(served.Certificate), served.Leaf, err)
	}

	row, err := e.st.GetTLSCertificate(ctx)
	if err != nil {
		t.Fatalf("GetTLSCertificate: %v", err)
	}
	if row.CertPEM != string(leafPEM) {
		t.Errorf("cert_pem = %q want the leaf alone", row.CertPEM)
	}
	if row.ChainPEM != string(interPEM)+string(rootPEM) {
		t.Errorf("chain_pem = %q want intermediate then root", row.ChainPEM)
	}
	for _, col := range []string{row.CertPEM, row.ChainPEM} {
		if strings.Contains(col, "#") || strings.Contains(col, "subject=") || strings.Contains(col, "PRIVATE KEY") {
			t.Errorf("stored column carries raw input: %q", col)
		}
	}
	if opened, err := authz.OpenSecret(e.srv.cfg.SecretKey, row.KeyEnc); err != nil || !sameKey(t, opened, keyPEM) {
		t.Errorf("sealed key does not open to the imported key: %v", err)
	}
}

// TestTLSImportAcceptsCombinedBundle: the file most CAs and tools hand out,
// certificate + key + CA in one PEM, pasted in the certificate field alone
// (nothing in the key field), is split by block type: the leaf is the
// certificate the key belongs to, the CA becomes the chain, and only
// CERTIFICATE blocks reach cert_pem / chain_pem while the key (PKCS#1 here) is
// sealed, re-serialized as PKCS#8. A chain pasted root-first is reordered.
func TestTLSImportAcceptsCombinedBundle(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)
	now := time.Now()

	rootKey := testECKey(t)
	rootPEM, root := testCA(t, "Test Root", rootKey, nil, nil, now.Add(-2*time.Hour), now.Add(72*time.Hour))
	interKey := testECKey(t)
	interPEM, inter := testCA(t, "Test Intermediate", interKey, root, rootKey, now.Add(-time.Hour), now.Add(48*time.Hour))
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	leafPEM, _ := testIssuedCertificate(t, "bundle.example.test", leafKey, inter, interKey, now.Add(-time.Hour), now.Add(24*time.Hour))
	pkcs1 := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(leafKey)})
	secret := keyBody(pkcs1)

	bundle := string(leafPEM) + string(pkcs1) + string(interPEM)
	rec := e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{
		"certPem": bundle, "chainPem": string(rootPEM) + string(interPEM), // root first, intermediate repeated
	}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("import code = %d (%s)", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "PRIVATE KEY") || strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("import response leaked key material")
	}
	body := decodeBody(t, rec)
	if body["mode"] != config.TLSModeCustom || body["hasCustomCertificate"] != true {
		t.Errorf("post-import status = %v", body)
	}
	cert, _ := body["certificate"].(map[string]any)
	if cert == nil || cert["subject"] != "CN=bundle.example.test" || cert["issuer"] != "CN=Test Intermediate" || cert["selfSignedCustom"] != false {
		t.Errorf("post-import certificate = %v", cert)
	}

	served, err := m.GetCertificate(&tls.ClientHelloInfo{})
	if err != nil || len(served.Certificate) != 3 || served.Leaf == nil || served.Leaf.Subject.CommonName != "bundle.example.test" {
		t.Fatalf("served chain = %d certificates, leaf %v, err %v", len(served.Certificate), served.Leaf, err)
	}
	if _, isRSA := served.PrivateKey.(*rsa.PrivateKey); !isRSA {
		t.Errorf("served key = %T want the RSA key from the bundle", served.PrivateKey)
	}

	row, err := e.st.GetTLSCertificate(ctx)
	if err != nil {
		t.Fatalf("GetTLSCertificate: %v", err)
	}
	if row.CertPEM != string(leafPEM) {
		t.Errorf("cert_pem = %q want the leaf alone", row.CertPEM)
	}
	if row.ChainPEM != string(interPEM)+string(rootPEM) {
		t.Errorf("chain_pem = %q want intermediate then root (reordered, deduplicated)", row.ChainPEM)
	}
	for _, col := range []string{row.CertPEM, row.ChainPEM, row.Subject, row.Issuer} {
		if strings.Contains(col, "PRIVATE KEY") || strings.Contains(col, secret) {
			t.Fatalf("private key persisted with the public material")
		}
	}
	opened, err := authz.OpenSecret(e.srv.cfg.SecretKey, row.KeyEnc)
	if err != nil || !sameKey(t, opened, pkcs1) {
		t.Errorf("sealed key does not open to the bundle's key: %v", err)
	}
	if blk, _ := pem.Decode(opened); blk == nil || blk.Type != "PRIVATE KEY" {
		t.Errorf("sealed key must be the PKCS#8 re-serialization, got %v", blk)
	}
	entries, _, _ := e.st.ListAudit(ctx, store.AuditFilter{Action: "tls.certificate.import"})
	if len(entries) != 1 || entries[0].Result != "success" || strings.Contains(entries[0].Detail, secret) || strings.Contains(entries[0].Detail, "PRIVATE KEY") {
		t.Errorf("audit rows = %+v", entries)
	}
}

// TestTLSImportRejectsBadMaterial maps each validation failure to its machine
// code and the precise message the UI shows as is, and proves a rejected
// import changes nothing (mode, store, manager). The headline case is the
// certificate signed with its own key while naming the CA as issuer, imported
// with that CA: the message says so and how to fix it.
func TestTLSImportRejectsBadMaterial(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)
	now := time.Now()

	k1, k2 := testECKey(t), testECKey(t)
	certPEM, keyPEM, _ := testCertificate(t, "ok.example.test", k1, now.Add(-time.Hour), now.Add(24*time.Hour))
	_, otherKeyPEM, _ := testCertificate(t, "other.example.test", k2, now.Add(-time.Hour), now.Add(24*time.Hour))
	expiredPEM, expiredKeyPEM, _ := testCertificate(t, "old.example.test", k1, now.Add(-48*time.Hour), now.Add(-time.Hour))
	futurePEM, futureKeyPEM, _ := testCertificate(t, "future.example.test", k1, now.Add(time.Hour), now.Add(48*time.Hour))
	rk, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	weakPEM, weakKeyPEM, _ := testCertificate(t, "weak.example.test", rk, now.Add(-time.Hour), now.Add(24*time.Hour))
	secret := keyBody(keyPEM)

	otherCAKey := testECKey(t)
	otherCAPEM, otherCA := testCA(t, "Unrelated CA", otherCAKey, nil, nil, now.Add(-time.Hour), now.Add(48*time.Hour))
	expiredCAKey := testECKey(t)
	expiredCAPEM, expiredCA := testCA(t, "Expired CA", expiredCAKey, nil, nil, now.Add(-48*time.Hour), now.Add(-time.Hour))
	leafOfExpiredPEM, leafOfExpiredKeyPEM := testIssuedCertificate(t, "chain.example.test", k2, expiredCA, expiredCAKey, now.Add(-time.Hour), now.Add(24*time.Hour))
	realCAKey := testECKey(t)
	_, realCA := testCA(t, "Real CA", realCAKey, nil, nil, now.Add(-time.Hour), now.Add(48*time.Hour))
	issuedPEM, issuedKeyPEM := testIssuedCertificate(t, "issued.example.test", k2, realCA, realCAKey, now.Add(-time.Hour), now.Add(24*time.Hour))
	misSignedPEM, misSignedKeyPEM := misSignedCertificate(t, "castor.example.test", k2, otherCA, now.Add(-time.Hour), now.Add(24*time.Hour))
	noSANTemplate := serverTemplate("nosan.example.test", now.Add(-time.Hour), now.Add(24*time.Hour))
	noSANTemplate.DNSNames = nil
	noSANPEM, _, _ := mintCertificate(t, noSANTemplate, nil, k1.Public(), k1)
	encryptedPEM := pem.EncodeToMemory(&pem.Block{Type: "ENCRYPTED PRIVATE KEY", Bytes: []byte{1, 2, 3}})
	legacyEncryptedPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Headers: map[string]string{"Proc-Type": "4,ENCRYPTED", "DEK-Info": "AES-128-CBC,00112233445566778899AABBCCDDEEFF"}, Bytes: []byte{1, 2, 3}})

	cases := []struct {
		name string
		body map[string]any
		code string
		want string
	}{
		{"key mismatch", map[string]any{"certPem": string(certPEM), "keyPem": string(otherKeyPEM)}, "tls_key_mismatch", "No certificate matches the private key (found CN=ok.example.test)"},
		{"expired", map[string]any{"certPem": string(expiredPEM), "keyPem": string(expiredKeyPEM)}, "tls_certificate_expired", "The certificate has expired"},
		{"not yet valid", map[string]any{"certPem": string(futurePEM), "keyPem": string(futureKeyPEM)}, "tls_invalid_certificate", "The certificate is not yet valid"},
		{"garbage", map[string]any{"certPem": "not a pem", "keyPem": string(otherKeyPEM)}, "tls_invalid_certificate", "No certificate found"},
		{"missing key", map[string]any{"certPem": string(certPEM)}, "tls_invalid_certificate", "No private key found"},
		{"two keys", map[string]any{"certPem": string(certPEM) + string(keyPEM), "keyPem": string(otherKeyPEM)}, "tls_invalid_certificate", "More than one private key found"},
		{"encrypted key", map[string]any{"certPem": string(certPEM), "keyPem": string(encryptedPEM)}, "tls_invalid_certificate", "Private key is encrypted (remove the passphrase first)"},
		{"legacy encrypted key", map[string]any{"certPem": string(certPEM), "keyPem": string(legacyEncryptedPEM)}, "tls_invalid_certificate", "Private key is encrypted (remove the passphrase first)"},
		{"weak rsa", map[string]any{"certPem": string(weakPEM), "keyPem": string(weakKeyPEM)}, "tls_invalid_certificate", "RSA key is too short (min 2048 bits)"},
		{"no SAN", map[string]any{"certPem": string(noSANPEM), "keyPem": string(keyPEM)}, "tls_invalid_certificate", "The certificate has no Subject Alternative Name; browsers reject such certificates. Re-issue it with DNS and/or IP names for the address you use to reach Castor (e.g. castor.example.com, localhost)."},
		{"self-signed leaf with the CA it names", map[string]any{"certPem": string(misSignedPEM) + string(misSignedKeyPEM) + string(otherCAPEM)}, "tls_invalid_certificate", "The certificate is not signed by the provided CA certificate: its Authority Key Identifier (AF:CA:29:FE:AD:5E:8A:89…) matches its own Subject Key Identifier, so it is self-signed. Re-issue it from your CA."},
		{"unrelated chain", map[string]any{"certPem": string(issuedPEM), "chainPem": string(otherCAPEM), "keyPem": string(issuedKeyPEM)}, "tls_invalid_certificate", "names another issuer and the provided CA (SKI " + fingerprintPrefix(otherCA.SubjectKeyId) + "…) did not sign it; export the intermediate that did."},
		{"self-signed leaf without AKI with an unrelated CA", map[string]any{"certPem": string(certPEM), "chainPem": string(otherCAPEM), "keyPem": string(keyPEM)}, "tls_invalid_certificate", "it has no Authority Key Identifier and its signature verifies with its own public key, so it is self-signed. Re-issue it from your CA."},
		{"expired intermediate", map[string]any{"certPem": string(leafOfExpiredPEM), "chainPem": string(expiredCAPEM), "keyPem": string(leafOfExpiredKeyPEM)}, "tls_invalid_certificate", "The CA certificate CN=Expired CA (chain #1) expired on"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", c.body, cookies, csrf)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("code = %d want 422 (%s)", rec.Code, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if got := tlsErrorCode(t, body); got != c.code {
				t.Errorf("error code = %q want %q (%s)", got, c.code, rec.Body.String())
			}
			// The message is the manager's explanation verbatim, never the
			// canonical placeholder.
			if msg := tlsErrorMessage(t, body); !strings.Contains(msg, c.want) || msg == authz.ErrTLSInvalidCertificate.Message {
				t.Errorf("error message = %q want it to contain %q", msg, c.want)
			}
			if strings.Contains(rec.Body.String(), "PRIVATE KEY") || strings.Contains(rec.Body.String(), secret) {
				t.Errorf("error response leaked key material")
			}
		})
	}

	// Oversized body (beyond the 256 KiB import cap) is refused before parsing.
	rec := e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{
		"certPem": strings.Repeat("A", tlsImportMaxBody+1), "keyPem": string(otherKeyPEM),
	}, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("oversized import code = %d want 422", rec.Code)
	}

	if m.Mode() != config.TLSModeSelfSigned || m.Status().Custom != nil {
		t.Errorf("rejected imports must leave the manager untouched: mode=%s custom=%v", m.Mode(), m.Status().Custom)
	}
	if _, err := e.st.GetTLSCertificate(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("rejected imports must not persist a row: %v", err)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSMode, ""); got != "" {
		t.Errorf("rejected imports must not persist tls.mode, got %q", got)
	}
	entries, _, _ := e.st.ListAudit(ctx, store.AuditFilter{Action: "tls.certificate.import"})
	for _, a := range entries {
		if a.Result == "success" {
			t.Errorf("rejected import audited as success: %+v", a)
		}
		if strings.Contains(a.Detail+a.TargetID+a.TargetName, secret) {
			t.Errorf("audit row leaked key material")
		}
	}
}

// TestTLSUpdateSettingsValidation covers PUT /settings/tls: invalid modes
// ("off" included: TLS is only turned off from the environment), ACME blocks
// without a usable domain (empty, wildcard, IP literal, bad email), custom
// without an imported certificate, and the self-signed <-> custom switches. No
// ACME issuance is started, so no network is touched.
func TestTLSUpdateSettingsValidation(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)

	rejected := []struct {
		name string
		body map[string]any
		want int
		code string
	}{
		{"bogus mode", map[string]any{"mode": "bogus"}, http.StatusUnprocessableEntity, "validation_failed"},
		{"off", map[string]any{"mode": "off"}, http.StatusUnprocessableEntity, "validation_failed"},
		{"off mixed case", map[string]any{"mode": " Off "}, http.StatusUnprocessableEntity, "validation_failed"},
		{"acme without block", map[string]any{"mode": "acme"}, http.StatusUnprocessableEntity, "validation_failed"},
		{"acme empty domains", map[string]any{"mode": "acme", "acme": map[string]any{"domains": []string{}}}, http.StatusUnprocessableEntity, "validation_failed"},
		{"acme wildcard", map[string]any{"mode": "acme", "acme": map[string]any{"domains": []string{"*.example.test"}}}, http.StatusUnprocessableEntity, "validation_failed"},
		{"acme ip", map[string]any{"mode": "acme", "acme": map[string]any{"domains": []string{"192.0.2.10"}}}, http.StatusUnprocessableEntity, "validation_failed"},
		{"acme bad email", map[string]any{"mode": "acme", "acme": map[string]any{"domains": []string{"castor.example.test"}, "email": "nope"}}, http.StatusUnprocessableEntity, "validation_failed"},
		{"custom without certificate", map[string]any{"mode": "custom"}, http.StatusConflict, "tls_no_custom_certificate"},
	}
	for _, c := range rejected {
		t.Run(c.name, func(t *testing.T) {
			rec := e.doHTTPS(t, http.MethodPut, "/api/v1/settings/tls", c.body, cookies, csrf)
			if rec.Code != c.want {
				t.Fatalf("code = %d want %d (%s)", rec.Code, c.want, rec.Body.String())
			}
			if got := tlsErrorCode(t, decodeBody(t, rec)); got != c.code {
				t.Errorf("error code = %q want %q (%s)", got, c.code, rec.Body.String())
			}
		})
	}
	if m.Mode() != config.TLSModeSelfSigned || m.Status().ACME != nil {
		t.Errorf("rejected updates must not change the manager: mode=%s acme=%v", m.Mode(), m.Status().ACME)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSMode, ""); got != "" {
		t.Errorf("rejected updates must not persist tls.mode, got %q", got)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSACMEDomains, ""); got != "" {
		t.Errorf("rejected updates must not persist tls.acme.domains, got %q", got)
	}

	// self-signed (any case): persisted + applied, no restart needed.
	rec := e.doHTTPS(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "Self-Signed"}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT self-signed code = %d (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["mode"] != config.TLSModeSelfSigned || body["restartRequired"] != false || body["effectiveMode"] != config.TLSModeSelfSigned {
		t.Errorf("PUT self-signed status = %v", body)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSMode, ""); got != config.TLSModeSelfSigned {
		t.Errorf("persisted tls.mode = %q want self-signed", got)
	}
	entries, _, _ := e.st.ListAudit(ctx, store.AuditFilter{Action: "tls.update", Result: "success"})
	if len(entries) != 1 || entries[0].TargetType != "tls" || entries[0].TargetName != config.TLSModeSelfSigned {
		t.Errorf("tls.update success audit rows = %+v", entries)
	}

	// custom becomes selectable once a certificate is imported; the import
	// itself already switches to custom, so go back to self-signed and re-select.
	now := time.Now()
	k := testECKey(t)
	certPEM, keyPEM, _ := testCertificate(t, "sel.example.test", k, now.Add(-time.Hour), now.Add(24*time.Hour))
	if rec := e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{"certPem": string(certPEM), "keyPem": string(keyPEM)}, cookies, csrf); rec.Code != http.StatusOK {
		t.Fatalf("import code = %d (%s)", rec.Code, rec.Body.String())
	}
	if rec := e.doHTTPS(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}, cookies, csrf); rec.Code != http.StatusOK {
		t.Fatalf("PUT self-signed after import code = %d", rec.Code)
	}
	if m.EffectiveMode() != config.TLSModeSelfSigned || m.Status().Custom == nil {
		t.Errorf("switching away from custom must keep the imported certificate installed")
	}
	rec = e.doHTTPS(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "custom"}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT custom with certificate code = %d (%s)", rec.Code, rec.Body.String())
	}
	if body := decodeBody(t, rec); body["effectiveMode"] != config.TLSModeCustom || body["hsts"] != true {
		t.Errorf("PUT custom status = %v", body)
	}
}

// TestTLSMutationsRequireHTTPS: while Castor terminates TLS itself, every TLS
// change must arrive on the HTTPS listener (the import carries a private key);
// the plain listener gets a 403 and nothing changes. A trusted proxy that
// terminated TLS (X-Forwarded-Proto: https) counts as HTTPS.
func TestTLSMutationsRequireHTTPS(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)
	now := time.Now()
	k := testECKey(t)
	certPEM, keyPEM, _ := testCertificate(t, "plain.example.test", k, now.Add(-time.Hour), now.Add(24*time.Hour))

	plain := []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{"mode switch", http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}},
		{"import", http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{"certPem": string(certPEM), "keyPem": string(keyPEM)}},
		{"remove", http.MethodDelete, "/api/v1/settings/tls/certificate", nil},
		{"renew", http.MethodPost, "/api/v1/settings/tls/acme/renew", nil},
	}
	for _, c := range plain {
		t.Run(c.name, func(t *testing.T) {
			rec := e.do(t, c.method, c.path, c.body, cookies, csrf)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("plain HTTP code = %d want 403 (%s)", rec.Code, rec.Body.String())
			}
			body := decodeBody(t, rec)
			if tlsErrorCode(t, body) != "forbidden" || !strings.Contains(tlsErrorMessage(t, body), "requires an HTTPS connection") {
				t.Errorf("plain HTTP error = %s", rec.Body.String())
			}
		})
	}
	if m.Status().Custom != nil {
		t.Errorf("a plain-HTTP import must not install anything")
	}
	if _, err := e.st.GetTLSCertificate(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("a plain-HTTP import must not persist a row: %v", err)
	}
	if got := e.st.GetSettingDefault(ctx, store.SettingTLSMode, ""); got != "" {
		t.Errorf("a plain-HTTP mode switch must not persist tls.mode, got %q", got)
	}

	// Reads stay available on plain HTTP.
	if rec := e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, ""); rec.Code != http.StatusOK {
		t.Errorf("plain HTTP GET code = %d want 200", rec.Code)
	}

	// Behind a trusted proxy, X-Forwarded-Proto: https is the HTTPS connection.
	e.srv.cfg.TrustProxy = true
	rec := e.tlsRequest(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}, cookies, csrf, false, "", map[string]string{"X-Forwarded-Proto": "https"})
	if rec.Code != http.StatusOK {
		t.Errorf("proxied HTTPS mode switch code = %d want 200 (%s)", rec.Code, rec.Body.String())
	}
	e.srv.cfg.TrustProxy = false
	rec = e.tlsRequest(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}, cookies, csrf, false, "", map[string]string{"X-Forwarded-Proto": "https"})
	if rec.Code != http.StatusForbidden {
		t.Errorf("X-Forwarded-Proto without CASTOR_TRUST_PROXY code = %d want 403", rec.Code)
	}
}

// TestTLSManagedByEnvRefusesChanges: with CASTOR_TLS_MODE=off the environment
// owns the mode; the status says so and every mutation is refused with 409
// tls_managed_by_env before anything is validated, installed or persisted.
func TestTLSManagedByEnvRefusesChanges(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManagerMode(t, e, config.TLSModeOff, true)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET code = %d (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["managedByEnv"] != true || body["serving"] != false || body["mode"] != config.TLSModeOff || body["effectiveMode"] != config.TLSModeOff {
		t.Errorf("status = %v", body)
	}
	if body["certificate"] != nil || body["hsts"] != false || body["redirect"] != false {
		t.Errorf("status with TLS off = %v", body)
	}

	now := time.Now()
	k := testECKey(t)
	certPEM, keyPEM, _ := testCertificate(t, "env.example.test", k, now.Add(-time.Hour), now.Add(24*time.Hour))
	mutations := []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{"self-signed", http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}},
		{"acme", http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "acme", "acme": map[string]any{"domains": []string{"castor.example.test"}}}},
		{"import", http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{"certPem": string(certPEM), "keyPem": string(keyPEM)}},
		{"remove", http.MethodDelete, "/api/v1/settings/tls/certificate", nil},
		{"renew", http.MethodPost, "/api/v1/settings/tls/acme/renew", nil},
	}
	for _, c := range mutations {
		t.Run(c.name, func(t *testing.T) {
			for _, https := range []bool{false, true} {
				rec := e.tlsRequest(t, c.method, c.path, c.body, cookies, csrf, https, "", nil)
				if rec.Code != http.StatusConflict {
					t.Fatalf("https=%t code = %d want 409 (%s)", https, rec.Code, rec.Body.String())
				}
				if got := tlsErrorCode(t, decodeBody(t, rec)); got != "tls_managed_by_env" {
					t.Errorf("https=%t error code = %q want tls_managed_by_env", https, got)
				}
			}
		})
	}
	if m.Mode() != config.TLSModeOff || m.Status().Custom != nil || m.Status().ACME != nil {
		t.Errorf("refused mutations must not change the manager: %+v", m.Status())
	}
	if _, err := e.st.GetTLSCertificate(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("refused import must not persist a row: %v", err)
	}
	for _, key := range []string{store.SettingTLSMode, store.SettingTLSACMEDomains} {
		if got := e.st.GetSettingDefault(ctx, key, ""); got != "" {
			t.Errorf("refused mutations must not persist %s, got %q", key, got)
		}
	}
}

// TestTLSACMERequiresHTTPSListener: selecting acme while the HTTPS listener
// is off is refused with 409 tls_https_off before autocert is configured (no
// CA order, no quota spent, nothing persisted). Without a listener there is
// no HTTPS to require, so the other modes are still reachable on plain HTTP
// and report the restart they need.
func TestTLSACMERequiresHTTPSListener(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManagerMode(t, e, config.TLSModeOff, false)
	ctx := context.Background()
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{
		"mode": "acme", "acme": map[string]any{"domains": []string{"castor.example.test"}, "email": "ops@example.test"},
	}, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Fatalf("PUT acme without HTTPS listener code = %d want 409 (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if tlsErrorCode(t, body) != "tls_https_off" || !strings.Contains(tlsErrorMessage(t, body), "CASTOR_TLS_MODE") {
		t.Errorf("error = %s", rec.Body.String())
	}
	if st := m.Status(); st.ACME != nil || st.Mode != config.TLSModeOff {
		t.Errorf("refused acme must not configure the manager: %+v", st)
	}
	for _, key := range []string{store.SettingTLSMode, store.SettingTLSACMEDomains, store.SettingTLSACMEEmail} {
		if got := e.st.GetSettingDefault(ctx, key, ""); got != "" {
			t.Errorf("refused acme must not persist %s, got %q", key, got)
		}
	}

	rec = e.do(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}, cookies, csrf)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT self-signed without HTTPS listener code = %d want 200 (%s)", rec.Code, rec.Body.String())
	}
	body = decodeBody(t, rec)
	if body["mode"] != config.TLSModeSelfSigned || body["effectiveMode"] != config.TLSModeOff || body["restartRequired"] != true || body["serving"] != false {
		t.Errorf("PUT self-signed status = %v", body)
	}
}

// TestTLSSettingsView: GET /settings/tls carries the fields the UI and the
// redirect share: publicHttpsUrl follows the redirect rule for the request's
// Host (no port or port 80 -> https://host, otherwise the HTTPS listen port),
// redirect mirrors CASTOR_HTTP_REDIRECT while the listener is on, and the
// served certificate reports whether it has expired.
func TestTLSSettingsView(t *testing.T) {
	e := newTestEnv(t)
	withTLSManager(t, e)
	cookies, _ := adminSession(t, e)

	for host, want := range map[string]string{
		"example.test":       "https://example.test",
		"example.test:80":    "https://example.test",
		"example.test:8080":  "https://example.test:8443",
		"[2001:db8::1]:8080": "https://[2001:db8::1]:8443",
		"":                   "https://example.test",
	} {
		rec := e.tlsRequest(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "", false, host, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET (host %q) code = %d (%s)", host, rec.Code, rec.Body.String())
		}
		if got := decodeBody(t, rec)["publicHttpsUrl"]; got != want {
			t.Errorf("publicHttpsUrl for host %q = %v want %q", host, got, want)
		}
	}

	rec := e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "")
	body := decodeBody(t, rec)
	if body["redirect"] != false || body["serving"] != true || body["managedByEnv"] != false || body["hsts"] != false {
		t.Errorf("status = %v", body)
	}
	// Castor's own self-signed certificate is not an imported one: the flag
	// that drives the trust-store warning stays false.
	if cert, _ := body["certificate"].(map[string]any); cert == nil || cert["expired"] != false || cert["selfSignedCustom"] != false {
		t.Errorf("certificate = %v want expired=false, selfSignedCustom=false", body["certificate"])
	}
	for _, key := range []string{"mode", "effectiveMode", "managedByEnv", "serving", "httpsAddr", "httpAddr", "redirect", "publicHttpsUrl", "hsts", "restartRequired", "certificate", "custom", "hasCustomCertificate", "acme"} {
		if _, present := body[key]; !present {
			t.Errorf("field %q missing from the status", key)
		}
	}

	e.srv.cfg.HTTPRedirect = true
	rec = e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "")
	if body := decodeBody(t, rec); body["redirect"] != true {
		t.Errorf("redirect with CASTOR_HTTP_REDIRECT = %v want true", body["redirect"])
	}
}

// TestTLSRenewACMEPreconditions: renewal is only meaningful in acme mode with
// configured domains; both refusals happen before any CA contact.
func TestTLSRenewACMEPreconditions(t *testing.T) {
	e := newTestEnv(t)
	m := withTLSManager(t, e)
	cookies, csrf := adminSession(t, e)

	rec := e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/acme/renew", nil, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Fatalf("renew in self-signed mode code = %d want 409 (%s)", rec.Code, rec.Body.String())
	}

	// acme mode without domains (mode set directly, bypassing the PUT validation).
	if err := m.SetMode(config.TLSModeACME); err != nil {
		t.Fatal(err)
	}
	rec = e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/acme/renew", nil, cookies, csrf)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("renew without domains code = %d want 422 (%s)", rec.Code, rec.Body.String())
	}
}

// TestTLSSettingsWithoutManager: a server built without a TLS manager reports
// TLS off and refuses configuration changes instead of panicking.
func TestTLSSettingsWithoutManager(t *testing.T) {
	e := newTestEnv(t)
	cookies, csrf := adminSession(t, e)

	rec := e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET code = %d (%s)", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["mode"] != config.TLSModeOff || body["effectiveMode"] != config.TLSModeOff || body["certificate"] != nil || body["hasCustomCertificate"] != false {
		t.Errorf("status without manager = %v", body)
	}
	if body["serving"] != false || body["managedByEnv"] != false || body["hsts"] != false || body["publicHttpsUrl"] != "https://example.test" {
		t.Errorf("status without manager = %v", body)
	}
	rec = e.doHTTPS(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "self-signed"}, cookies, csrf)
	if rec.Code != http.StatusConflict {
		t.Errorf("PUT without manager code = %d want 409", rec.Code)
	}
	rec = e.do(t, http.MethodGet, "/api/v1/settings/tls/certificate.pem", nil, cookies, "")
	if rec.Code != http.StatusNotFound {
		t.Errorf("download without manager code = %d want 404", rec.Code)
	}
}

// TestTLSSettingsRBAC: a viewer (settings.read only) can read the status and
// download the public certificate but cannot import a certificate or switch
// modes, even over HTTPS; the denial is audited.
func TestTLSSettingsRBAC(t *testing.T) {
	e := newTestEnv(t)
	withTLSManager(t, e)
	ctx := context.Background()
	adminSession(t, e) // leaves bootstrap mode

	hash, err := authz.HashPassword("viewerpassword1")
	if err != nil {
		t.Fatal(err)
	}
	uid := store.NewUUID()
	if err := e.st.CreateUser(ctx, &store.User{ID: uid, Username: "viewer", PasswordHash: hash, IsActive: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.CreateBinding(ctx, &store.Binding{ID: store.NewUUID(), UserID: uid, RoleID: store.RoleIDViewer, ScopeType: "global"}); err != nil {
		t.Fatal(err)
	}
	rec := e.do(t, http.MethodPost, "/api/v1/auth/login", map[string]any{"username": "viewer", "password": "viewerpassword1"}, nil, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("viewer login code = %d (%s)", rec.Code, rec.Body.String())
	}
	csrf, _ := decodeBody(t, rec)["csrfToken"].(string)
	cookies := rec.Result().Cookies()

	if rec := e.do(t, http.MethodGet, "/api/v1/settings/tls", nil, cookies, ""); rec.Code != http.StatusOK {
		t.Errorf("viewer GET tls code = %d want 200", rec.Code)
	}
	if rec := e.do(t, http.MethodGet, "/api/v1/settings/tls/certificate.pem", nil, cookies, ""); rec.Code != http.StatusOK {
		t.Errorf("viewer download code = %d want 200", rec.Code)
	}

	now := time.Now()
	k := testECKey(t)
	certPEM, keyPEM, _ := testCertificate(t, "viewer.example.test", k, now.Add(-time.Hour), now.Add(24*time.Hour))
	rec = e.doHTTPS(t, http.MethodPost, "/api/v1/settings/tls/certificate", map[string]any{"certPem": string(certPEM), "keyPem": string(keyPEM)}, cookies, csrf)
	if rec.Code != http.StatusForbidden {
		t.Errorf("viewer import code = %d want 403", rec.Code)
	}
	if rec := e.doHTTPS(t, http.MethodPut, "/api/v1/settings/tls", map[string]any{"mode": "custom"}, cookies, csrf); rec.Code != http.StatusForbidden {
		t.Errorf("viewer PUT code = %d want 403", rec.Code)
	}
	entries, _, _ := e.st.ListAudit(ctx, store.AuditFilter{Action: "tls.certificate.import"})
	if len(entries) != 1 || entries[0].Result != "denied" || entries[0].ActorName != "viewer" {
		t.Errorf("denied import audit rows = %+v", entries)
	}
	if _, err := e.st.GetTLSCertificate(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("denied import must not persist a row: %v", err)
	}
}
