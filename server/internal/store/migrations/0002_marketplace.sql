-- Castor marketplace / app-templates schema (migration 0002).
-- Conventions inherited from 0001_init.sql:
--   * TEXT ids are UUIDv4 (store.NewUUID()), PRIMARY KEY.
--   * All *_at columns are unix epoch SECONDS (UTC) stored as INTEGER.
--   * Booleans are INTEGER 0/1.
--   * JSON-typed columns (ports, env, volumes) are stored as TEXT holding a JSON
--     document; the store layer marshals/unmarshals them (mirrors roles.permissions).
--   * Secrets at rest are BLOB sealed with authz.SealSecret (AES-256-GCM under
--     CASTOR_SECRET_KEY); never serialized to JSON (json:"-").
--   * PRAGMA foreign_keys=ON is set at connect time.

-- ---------------------------------------------------------------------------
-- templates_custom: operator-authored app templates, layered ON TOP of the
-- 50 built-in templates embedded from shared/templates-catalog.json. The
-- built-in catalog is read-only and lives in the binary, NOT in this table.
-- `slug` is unique across custom templates (built-ins are namespaced separately
-- by the API, which prefixes/marks source=builtin|custom).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates_custom (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    category    TEXT NOT NULL DEFAULT 'Custom',
    image       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    ports       TEXT NOT NULL DEFAULT '[]',  -- JSON array of ints, e.g. [5432]
    env         TEXT NOT NULL DEFAULT '[]',  -- JSON array of {key,value,required}
    volumes     TEXT NOT NULL DEFAULT '[]',  -- JSON array of container paths
    logo_url    TEXT,                        -- optional absolute/relative logo URL; null -> initials fallback
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_templates_custom_category ON templates_custom(category);
CREATE INDEX IF NOT EXISTS idx_templates_custom_created ON templates_custom(created_at);

-- ---------------------------------------------------------------------------
-- registries: private/public image registry credentials. `secret_enc` holds the
-- AES-256-GCM sealed password/token and is NEVER returned in any API response.
-- `type` is one of dockerhub|ghcr|gitlab|quay|ecr|custom.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registries (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    type       TEXT NOT NULL DEFAULT 'custom',  -- dockerhub|ghcr|gitlab|quay|ecr|custom
    url        TEXT NOT NULL DEFAULT '',        -- registry host, e.g. ghcr.io / registry.example.com
    username   TEXT NOT NULL DEFAULT '',
    secret_enc BLOB,                            -- sealed password/token; json:"-"
    email      TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_registries_type ON registries(type);

-- ---------------------------------------------------------------------------
-- stacks: a deployed multi-container compose stack. `compose_yaml` is the
-- validated source document. `status` is the lifecycle marker
-- (pending|running|partial|stopped|error). project_name is the docker compose
-- project label (com.docker.compose.project) used to enumerate/teardown.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stacks (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    project_name TEXT NOT NULL UNIQUE,           -- compose project label; sanitized [a-z0-9_-]
    host_id      TEXT NOT NULL DEFAULT 'local' REFERENCES registered_hosts(id) ON DELETE CASCADE,
    compose_yaml TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending', -- pending|running|partial|stopped|error
    service_count INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stacks_host ON stacks(host_id);
CREATE INDEX IF NOT EXISTS idx_stacks_status ON stacks(status);

-- ---------------------------------------------------------------------------
-- remote_catalogs: external template catalogs (a JSON URL serving the same
-- shape as the built-in catalog). Fetched on demand / on refresh; their
-- templates are merged into the marketplace listing as source=remote and are
-- NOT persisted as rows (only the catalog source is persisted here).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remote_catalogs (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    enabled         INTEGER NOT NULL DEFAULT 1,
    last_fetched_at INTEGER,
    template_count  INTEGER NOT NULL DEFAULT 0,
    last_error      TEXT,                         -- last fetch error message, null on success
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_remote_catalogs_enabled ON remote_catalogs(enabled);

-- ---------------------------------------------------------------------------
-- backups: volume tar backups produced by exporting a Docker volume's contents.
-- `kind` is 'volume' in V1. `file_path` is the server-side path of the tar
-- archive under the backups dir. `status` is pending|completed|failed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS backups (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL DEFAULT 'volume',   -- volume (V1)
    host_id     TEXT NOT NULL DEFAULT 'local' REFERENCES registered_hosts(id) ON DELETE CASCADE,
    target_name TEXT NOT NULL,                    -- volume name backed up
    file_path   TEXT NOT NULL DEFAULT '',         -- server path of the .tar archive
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending|completed|failed
    error       TEXT,                             -- failure message, null on success
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_host ON backups(host_id);
CREATE INDEX IF NOT EXISTS idx_backups_target ON backups(kind, target_name);
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at);
