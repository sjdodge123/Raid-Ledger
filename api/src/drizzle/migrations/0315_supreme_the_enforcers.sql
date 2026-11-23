ALTER TABLE "event_signups" ADD COLUMN "activated_at" timestamp DEFAULT (now() at time zone 'utc') NOT NULL;--> statement-breakpoint
-- ROK-2293 (hand-added backfill): existing signups became active when they signed up.
UPDATE "event_signups" SET "activated_at" = "signed_up_at";
