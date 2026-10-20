-- Short-lived, single-use agent enrollment credentials. Only SHA-256 digests
-- are persisted; the bearer value is returned once by the API and never logged.
CREATE TABLE IF NOT EXISTS agent_enrollments (
    id          TEXT PRIMARY KEY,
    host_id     TEXT NOT NULL REFERENCES registered_hosts(id) ON DELETE CASCADE,
    token_hash  BLOB NOT NULL UNIQUE,
    expires_at  INTEGER NOT NULL,
    consumed_at INTEGER,
    revoked_at  INTEGER,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_enrollments_host ON agent_enrollments(host_id);