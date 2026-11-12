ALTER TABLE "wow_item_meta" ADD COLUMN "tooltip" jsonb;--> statement-breakpoint
ALTER TABLE "wow_item_meta" ADD COLUMN "tooltip_version" smallint;--> statement-breakpoint
-- ROK-2176 (hand-added): self-contained re-schedule of every found row so the
-- existing daily retry job re-probes it and fills tooltip. Depends on no app data.
UPDATE "wow_item_meta" SET "next_retry_at" = now() WHERE "status" IN ('resolved','classic_fallback');
