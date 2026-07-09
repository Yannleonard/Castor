-- Castor outbound notification channels (migration 0005).
-- Conventions inherited from 0001: TEXT ids, *_at columns are unix epoch
-- seconds (UTC) as INTEGER, foreign_keys=ON at connect time.
--
-- url_enc holds the webhook URL sealed with AES-256-GCM (the URL embeds the
-- secret token for Discord/Slack/ntfy endpoints). Sealing happens in the API
-- layer via authz.SealSecret; the store treats the BLOB as opaque. events is
-- a JSON array of subscribed event kinds, e.g.
-- ["container.down","update.available"].
CREATE TABLE IF NOT EXISTS notification_channels (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL CHECK (type IN ('discord','slack','ntfy','webhook')),
    url_enc    BLOB NOT NULL,
    events     TEXT NOT NULL,
    enabled    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
