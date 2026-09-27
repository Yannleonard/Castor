package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// TLS settings keys. They are editable from the Settings UI and, when present,
// take precedence over the CASTOR_TLS_MODE env default (resolved at startup).
const (
	// SettingTLSMode is one of self-signed, custom, acme, off (config.TLSMode*).
	SettingTLSMode = "tls.mode"
	// SettingTLSACMEDomains is the comma-separated ACME domain list
	// (ParseTLSDomains / FormatTLSDomains).
	SettingTLSACMEDomains = "tls.acme.domains"
	// SettingTLSACMEEmail is the optional ACME account contact.
	SettingTLSACMEEmail = "tls.acme.email"
	// SettingTLSACMEStaging is "true" to use the Let's Encrypt staging CA.
	SettingTLSACMEStaging = "tls.acme.staging"
)

// TLSCertificate is the single row of tls_certificates: the imported
// certificate served in "custom" mode. KeyEnc is the private key sealed by the
// API layer (authz.SealSecret) and is opaque here; it is never serialized.
// CertPEM/ChainPEM are public material but excluded from the default JSON view
// too — the API exposes the certificate through the TLS manager's status.
type TLSCertificate struct {
	ID                string `json:"id"`
	CertPEM           string `json:"-"`
	ChainPEM          string `json:"-"`
	KeyEnc            []byte `json:"-"`
	Subject           string `json:"subject"`
	Issuer            string `json:"issuer"`
	NotBefore         int64  `json:"notBefore"`
	NotAfter          int64  `json:"notAfter"`
	FingerprintSHA256 string `json:"fingerprintSha256"`
	CreatedAt         int64  `json:"createdAt"`
}

const tlsCertificateCols = `id, cert_pem, chain_pem, key_enc, subject, issuer, not_before, not_after, fingerprint_sha256, created_at`

func scanTLSCertificate(row interface{ Scan(...any) error }) (*TLSCertificate, error) {
	var c TLSCertificate
	if err := row.Scan(&c.ID, &c.CertPEM, &c.ChainPEM, &c.KeyEnc, &c.Subject, &c.Issuer,
		&c.NotBefore, &c.NotAfter, &c.FingerprintSHA256, &c.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// GetTLSCertificate returns the active imported certificate, or ErrNotFound.
func (s *Store) GetTLSCertificate(ctx context.Context) (*TLSCertificate, error) {
	return scanTLSCertificate(s.db.QueryRowContext(ctx,
		`SELECT `+tlsCertificateCols+` FROM tls_certificates ORDER BY created_at DESC LIMIT 1`))
}

// UpsertTLSCertificate replaces the active certificate with c in one
// transaction, so there is never more than one row. The caller fills the
// metadata and the sealed key; ID (store.NewUUID()) and CreatedAt are assigned
// here when unset.
func (s *Store) UpsertTLSCertificate(ctx context.Context, c *TLSCertificate) error {
	if c.ID == "" {
		c.ID = NewUUID()
	}
	if c.CreatedAt == 0 {
		c.CreatedAt = time.Now().Unix()
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM tls_certificates`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO tls_certificates (`+tlsCertificateCols+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		c.ID, c.CertPEM, c.ChainPEM, c.KeyEnc, c.Subject, c.Issuer,
		c.NotBefore, c.NotAfter, c.FingerprintSHA256, c.CreatedAt); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteTLSCertificate removes the imported certificate. ErrNotFound when none.
func (s *Store) DeleteTLSCertificate(ctx context.Context) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM tls_certificates`)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// ParseTLSDomains decodes the tls.acme.domains setting: a comma/whitespace
// separated list (the stored form) or a JSON array of strings. Entries are
// trimmed, lower-cased and de-duplicated; validation is the TLS manager's job.
func ParseTLSDomains(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var parts []string
	if strings.HasPrefix(raw, "[") {
		if err := json.Unmarshal([]byte(raw), &parts); err != nil {
			return nil
		}
	} else {
		parts = strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == ';' })
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
	}
	return out
}

// FormatTLSDomains encodes a domain list for the tls.acme.domains setting.
func FormatTLSDomains(domains []string) string {
	return strings.Join(ParseTLSDomains(strings.Join(domains, ",")), ",")
}
