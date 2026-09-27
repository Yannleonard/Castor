-- Castor TLS certificates (migration 0007).
-- Conventions inherited from 0001: TEXT ids, *_at / not_* columns are unix epoch
-- seconds (UTC) as INTEGER, foreign_keys=ON at connect time.
--
-- tls_certificates holds the operator-imported ("custom") certificate served
-- when the tls.mode setting is "custom": the PEM leaf, its optional PEM chain
-- and the private key sealed with AES-256-GCM. Sealing happens in the API layer
-- via authz.SealSecret; the store treats key_enc as an opaque BLOB and the
-- plaintext key never reaches the database, the audit log or an API response.
-- The parsed metadata (subject, issuer, validity, SHA-256 fingerprint) is
-- denormalized for the Settings UI so the key never has to be opened to
-- display the certificate. There is at most ONE row: UpsertTLSCertificate
-- replaces it atomically. The self-signed fallback lives on disk (<TLSDir>),
-- the ACME cache too; neither is stored here. The editable TLS settings
-- (tls.mode, tls.acme.domains, tls.acme.email, tls.acme.staging) live in the
-- generic settings table.
CREATE TABLE IF NOT EXISTS tls_certificates (
    id                 TEXT PRIMARY KEY,
    cert_pem           TEXT NOT NULL,
    chain_pem          TEXT NOT NULL DEFAULT '',
    key_enc            BLOB NOT NULL,
    subject            TEXT NOT NULL,
    issuer             TEXT NOT NULL,
    not_before         INTEGER NOT NULL,
    not_after          INTEGER NOT NULL,
    fingerprint_sha256 TEXT NOT NULL,
    created_at         INTEGER NOT NULL
);
