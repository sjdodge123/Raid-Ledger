ALTER TABLE "lfg_intents" ADD COLUMN "group_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lfg_invites" ADD COLUMN "group_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lfg_group_messages" ADD COLUMN "group_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lfg_intents_user_game_group_active" ON "lfg_intents" USING btree ("user_id","game_id","group_key") WHERE "lfg_intents"."status" = 'active';--> statement-breakpoint
DROP INDEX "uq_lfg_intents_user_game_active";--> statement-breakpoint
CREATE INDEX "idx_lfg_intents_game_group_active" ON "lfg_intents" USING btree ("game_id","group_key") WHERE "lfg_intents"."status" = 'active';--> statement-breakpoint
DROP INDEX "idx_lfg_intents_game_active";--> statement-breakpoint
CREATE INDEX "idx_lfg_invites_game_group_sent_at" ON "lfg_invites" USING btree ("game_id","group_key","sent_at");--> statement-breakpoint
DROP INDEX "idx_lfg_invites_game_sent_at";--> statement-breakpoint
CREATE INDEX "idx_lfg_invites_recipient_game_group_sent_at" ON "lfg_invites" USING btree ("recipient_user_id","game_id","group_key","sent_at");--> statement-breakpoint
DROP INDEX "idx_lfg_invites_recipient_game_sent_at";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lfg_group_messages_game_open_next" ON "lfg_group_messages" USING btree ("game_id","group_key") WHERE "lfg_group_messages"."state" = 'open';--> statement-breakpoint
DROP INDEX "uq_lfg_group_messages_game_open";--> statement-breakpoint
ALTER INDEX "uq_lfg_group_messages_game_open_next" RENAME TO "uq_lfg_group_messages_game_open";--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_group_key_check" CHECK ("lfg_intents"."group_key" = '' OR "lfg_intents"."group_key" ~ '^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9:_-]{1,64}$');