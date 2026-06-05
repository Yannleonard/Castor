-- Castor initial schema (ADR-CASTOR-003 §4).
-- All *_at columns are unix epoch seconds (UTC). TEXT ids are UUIDv4.
-- Booleans are INTEGER 0/1. PRAGMA foreign_keys=ON is set at connect time.

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id                TEXT PRIMARY KEY,
    username          TEXT NOT NULL UNIQUE,
    email             TEXT,
    password_hash     TEXT NOT NULL,
    totp_secret_enc   BLOB,
    totp_enabled      INTEGER NOT NULL DEFAULT 0,
    totp_confirmed_at INTEGER,
    is_active         INTEGER NOT NULL DEFAULT 1,
    must_change_pw    INTEGER NOT NULL DEFAULT 0,
    failed_logins     INTEGER NOT NULL DEFAULT 0,
    locked_until      INTEGER,
    last_login_at     INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_codes (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);

-- store SHA-256(session_id) in sessions.id; the raw id lives only in the cookie.
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token   TEXT NOT NULL,
    user_agent   TEXT,
    ip           TEXT,
    amr          TEXT NOT NULL DEFAULT 'pwd',
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS roles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    permissions TEXT NOT NULL DEFAULT '[]',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS role_bindings (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL DEFAULT 'global',
    scope_id   TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, role_id, scope_type, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_bindings_user ON role_bindings(user_id);

-- append-only: never UPDATE/DELETE rows in audit_log.
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    actor_id    TEXT,
    actor_name  TEXT NOT NULL,
    actor_ip    TEXT,
    action      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT,
    target_name TEXT,
    scope_type  TEXT,
    scope_id    TEXT,
    result      TEXT NOT NULL,
    http_status INTEGER,
    detail      TEXT,
    request_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target_type, target_id);

CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS registered_hosts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    connection   TEXT NOT NULL DEFAULT 'local-socket',
    endpoint     TEXT,
    agent_pubkey BLOB,
    enrolled_at  INTEGER,
    last_seen_at INTEGER,
    status       TEXT NOT NULL DEFAULT 'connected',
    created_at   INTEGER NOT NULL
);
