-- Castor SSO / external identity schema (migration 0003).
-- Adds LDAP/LDAPS + Microsoft Entra ID (OIDC) authentication on top of the
-- local password auth from 0001. Conventions inherited from 0001/0002:
--   * TEXT ids are UUIDv4 (store.NewUUID()), PRIMARY KEY.
--   * *_at columns are unix epoch SECONDS (UTC) as INTEGER.
--   * Booleans are INTEGER 0/1.
--   * Secrets at rest are BLOB sealed with authz.SealSecret (AES-256-GCM under
--     CASTOR_SECRET_KEY) in the API layer; never serialized to JSON (json:"-").

-- ---------------------------------------------------------------------------
-- users: mark externally-provisioned identities. A local user keeps a real
-- password_hash; an external (LDAP/OIDC) user is created by JIT provisioning
-- with auth_source set and password_hash left as a non-usable sentinel ('!').
-- external_id is the stable subject from the IdP (LDAP entryUUID/DN or OIDC
-- 'oid'/'sub'), unique per source so re-logins map to the same Castor user.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'; -- local|ldap|oidc
ALTER TABLE users ADD COLUMN external_id TEXT;                          -- IdP subject (null for local)
ALTER TABLE users ADD COLUMN external_provider_id TEXT;                 -- -> auth_providers.id
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external
    ON users(auth_source, external_id) WHERE external_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- auth_providers: one row per configured external identity provider. `kind`
-- selects which subset of columns is meaningful (ldap vs oidc). At most one
-- enabled provider per kind is expected in V1 but not enforced here.
--
-- Shared:
--   name, kind(ldap|oidc), enabled, default_role_id (JIT fallback role),
--   created_at, updated_at.
-- LDAP columns:
--   ldap_host, ldap_port, ldap_tls(none|starttls|ldaps), ldap_skip_verify,
--   ldap_bind_dn, ldap_bind_pw_enc (sealed), ldap_base_dn, ldap_user_filter
--   (e.g. (&(objectClass=person)(sAMAccountName=%s))), ldap_attr_username,
--   ldap_attr_email, ldap_attr_display, ldap_group_base_dn, ldap_group_filter,
--   ldap_attr_member.
-- OIDC columns (Entra ID):
--   oidc_issuer (https://login.microsoftonline.com/<tenant>/v2.0),
--   oidc_client_id, oidc_client_secret_enc (sealed), oidc_redirect_url,
--   oidc_scopes (space-separated, default 'openid profile email'),
--   oidc_groups_claim (default 'groups'), oidc_username_claim (default
--   'preferred_username'), oidc_email_claim (default 'email').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_providers (
    id                     TEXT PRIMARY KEY,
    name                   TEXT NOT NULL,
    kind                   TEXT NOT NULL,                  -- ldap|oidc
    enabled                INTEGER NOT NULL DEFAULT 0,
    default_role_id        TEXT REFERENCES roles(id) ON DELETE SET NULL,

    -- LDAP
    ldap_host              TEXT NOT NULL DEFAULT '',
    ldap_port              INTEGER NOT NULL DEFAULT 389,
    ldap_tls               TEXT NOT NULL DEFAULT 'starttls', -- none|starttls|ldaps
    ldap_skip_verify       INTEGER NOT NULL DEFAULT 0,
    ldap_bind_dn           TEXT NOT NULL DEFAULT '',
    ldap_bind_pw_enc       BLOB,
    ldap_base_dn           TEXT NOT NULL DEFAULT '',
    ldap_user_filter       TEXT NOT NULL DEFAULT '(&(objectClass=person)(sAMAccountName=%s))',
    ldap_attr_username     TEXT NOT NULL DEFAULT 'sAMAccountName',
    ldap_attr_email        TEXT NOT NULL DEFAULT 'mail',
    ldap_attr_display      TEXT NOT NULL DEFAULT 'displayName',
    ldap_group_base_dn     TEXT NOT NULL DEFAULT '',
    ldap_group_filter      TEXT NOT NULL DEFAULT '(&(objectClass=group)(member=%s))',
    ldap_attr_member       TEXT NOT NULL DEFAULT 'memberOf',

    -- OIDC (Entra ID)
    oidc_issuer            TEXT NOT NULL DEFAULT '',
    oidc_client_id         TEXT NOT NULL DEFAULT '',
    oidc_client_secret_enc BLOB,
    oidc_redirect_url      TEXT NOT NULL DEFAULT '',
    oidc_scopes            TEXT NOT NULL DEFAULT 'openid profile email',
    oidc_groups_claim      TEXT NOT NULL DEFAULT 'groups',
    oidc_username_claim    TEXT NOT NULL DEFAULT 'preferred_username',
    oidc_email_claim       TEXT NOT NULL DEFAULT 'email',

    created_at             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_providers_kind ON auth_providers(kind, enabled);

-- ---------------------------------------------------------------------------
-- group_role_mappings: maps an external group (LDAP group DN/name, or an Entra
-- group object-id/name present in the token's groups claim) to a Castor role.
-- At login, the union of the user's external groups is resolved to roles; a user
-- with no matching mapping falls back to the provider's default_role_id.
-- `external_group` is matched case-insensitively against both the raw group
-- value and its CN.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_role_mappings (
    id             TEXT PRIMARY KEY,
    provider_id    TEXT NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
    external_group TEXT NOT NULL,                 -- group DN / CN / Entra group id or name
    role_id        TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    created_at     INTEGER NOT NULL,
    UNIQUE(provider_id, external_group, role_id)
);
CREATE INDEX IF NOT EXISTS idx_group_role_mappings_provider ON group_role_mappings(provider_id);

-- ---------------------------------------------------------------------------
-- oidc_auth_states: short-lived CSRF/PKCE state for the OIDC redirect flow.
-- A row is created at /auth/oidc/start and consumed at the callback; expired
-- rows are GC'd. nonce binds the id_token; pkce_verifier supports PKCE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oidc_auth_states (
    state          TEXT PRIMARY KEY,
    provider_id    TEXT NOT NULL REFERENCES auth_providers(id) ON DELETE CASCADE,
    nonce          TEXT NOT NULL,
    pkce_verifier  TEXT NOT NULL,
    redirect_after TEXT NOT NULL DEFAULT '/',
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oidc_states_expires ON oidc_auth_states(expires_at);
