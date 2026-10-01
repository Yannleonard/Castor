-- Castor by IT Leonard
-- Castor personal access tokens (migration 0004).
-- Conventions inherited from 0001: TEXT ids, *_at columns are unix epoch
-- seconds (UTC) as INTEGER, foreign_keys=ON at connect time.
--
-- api_tokens.id stores the hex SHA-256 of the raw token (like sessions.id);
-- the raw token ("castor_pat_" + 64 hex chars) is shown once at creation and
-- never persisted. prefix keeps the first 8 chars of the random part so the
-- UI can identify a token without ever storing the secret.
CREATE TABLE IF NOT EXISTS api_tokens (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER,             -- NULL = never expires
    last_used_at INTEGER,
    revoked_at   INTEGER              -- soft delete; row kept for the UI list
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
