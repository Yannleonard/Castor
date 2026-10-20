-- Reported agent build metadata for advisory upgrade guidance.
ALTER TABLE registered_hosts ADD COLUMN agent_version TEXT NOT NULL DEFAULT '';
