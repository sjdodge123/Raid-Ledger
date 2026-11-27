ALTER TABLE "lfg_intents" ADD COLUMN "cleared_reason" text;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD COLUMN "cleared_into_group_key" text;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD COLUMN "cleared_notice_seen_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_lfg_intents_cleared_notice_unseen" ON "lfg_intents" USING btree ("user_id","game_id") WHERE "lfg_intents"."cleared_reason" IS NOT NULL AND "lfg_intents"."cleared_notice_seen_at" IS NULL;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_cleared_reason_check" CHECK ("lfg_intents"."cleared_reason" IS NULL OR "lfg_intents"."cleared_reason" IN ('sibling_locked_in'));