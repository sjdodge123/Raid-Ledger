-- ROK-1067: public-shareable lineup link.
-- Adds public_share_enabled (boolean) and public_slug (URL-safe varchar) to
-- community_lineups. The slug column is added nullable so existing rows can
-- be backfilled in-place before flipping NOT NULL and the UNIQUE constraint.
ALTER TABLE "community_lineups" ADD COLUMN "public_share_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "public_slug" varchar(16);--> statement-breakpoint
-- Backfill any pre-existing dev rows with a 12-char slug from a UUID v4.
-- ~48 bits of entropy per row; collision risk is ~10^-11 for ≤100 rows.
-- Migrations run during deploy with the API restarted, so concurrent inserts
-- from the slug-aware code path are not possible during this window.
UPDATE "community_lineups"
SET "public_slug" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
WHERE "public_slug" IS NULL;--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "public_slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_public_slug_unique" UNIQUE("public_slug");--> statement-breakpoint
-- Force public_share_enabled = false for existing private lineups
-- (refine on CreateLineupSchema rejects this combination going forward).
UPDATE "community_lineups"
SET "public_share_enabled" = false
WHERE "visibility" = 'private';
