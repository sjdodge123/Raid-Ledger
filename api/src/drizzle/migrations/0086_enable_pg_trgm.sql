-- ROK-705: Install pg_trgm extension for fuzzy game matching.
-- PresenceGameDetectorService uses trigram similarity to match Discord
-- activity names to games. Without this extension it falls back to
-- exact / alias-only lookups and logs a WARN on startup.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
