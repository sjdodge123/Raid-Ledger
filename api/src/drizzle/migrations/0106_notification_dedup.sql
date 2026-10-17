-- ROK-978: Database-backed notification dedup guard.
-- Survives Redis restarts by persisting dedup state in PostgreSQL.

CREATE TABLE IF NOT EXISTS "notification_dedup" (
  "id" serial PRIMARY KEY NOT NULL,
  "dedup_key" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_dedup_key" ON "notification_dedup" ("dedup_key");
CREATE INDEX IF NOT EXISTS "idx_notification_dedup_expires_at" ON "notification_dedup" ("expires_at");
