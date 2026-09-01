CREATE TABLE "lfg_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"visibility" text DEFAULT 'local' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"converted_to_poll_id" integer,
	"converted_to_event_id" integer,
	CONSTRAINT "lfg_intents_status_check" CHECK ("lfg_intents"."status" IN ('active', 'converted', 'expired', 'cleared')),
	CONSTRAINT "lfg_intents_visibility_check" CHECK ("lfg_intents"."visibility" IN ('local', 'cross-community'))
);
--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_converted_to_poll_id_community_lineup_matches_id_fk" FOREIGN KEY ("converted_to_poll_id") REFERENCES "public"."community_lineup_matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfg_intents" ADD CONSTRAINT "lfg_intents_converted_to_event_id_events_id_fk" FOREIGN KEY ("converted_to_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lfg_intents_user_game_active" ON "lfg_intents" USING btree ("user_id","game_id") WHERE "lfg_intents"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_lfg_intents_game_active" ON "lfg_intents" USING btree ("game_id") WHERE "lfg_intents"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_lfg_intents_expires_at" ON "lfg_intents" USING btree ("expires_at") WHERE "lfg_intents"."status" = 'active';