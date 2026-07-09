-- Castor GitOps for compose stacks (migration 0006).
-- Conventions inherited from 0001: TEXT ids, *_at columns are unix epoch
-- seconds (UTC) as INTEGER, booleans are INTEGER 0/1, foreign_keys=ON.
--
-- These columns let a stack track a git repository as the source of truth for
-- its compose file. git_token_enc holds a git PAT sealed with AES-256-GCM in the
-- API layer via authz.SealSecret (the store treats it as an opaque BLOB, never
-- returned by the API). webhook_secret_hash is the hex SHA-256 of the redeploy
-- webhook secret (the raw secret is shown once at creation, never persisted),
-- mirroring how sessions/PATs store only the hash. auto_deploy gates the public
-- webhook: only stacks with auto_deploy=1 may be redeployed by a hook call.
ALTER TABLE stacks ADD COLUMN git_repo_url TEXT;
ALTER TABLE stacks ADD COLUMN git_ref TEXT;
ALTER TABLE stacks ADD COLUMN git_path TEXT NOT NULL DEFAULT 'docker-compose.yml';
ALTER TABLE stacks ADD COLUMN git_token_enc BLOB;
ALTER TABLE stacks ADD COLUMN webhook_secret_hash TEXT;
ALTER TABLE stacks ADD COLUMN last_synced_commit TEXT;
ALTER TABLE stacks ADD COLUMN auto_deploy INTEGER NOT NULL DEFAULT 0;

-- Look up a stack by its webhook secret hash (public redeploy hook). Unique so a
-- generated secret maps to at most one stack.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stacks_webhook_hash
    ON stacks(webhook_secret_hash)
    WHERE webhook_secret_hash IS NOT NULL;
