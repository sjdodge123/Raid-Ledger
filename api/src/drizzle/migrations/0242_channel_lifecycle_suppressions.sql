CREATE TABLE "channel_lifecycle_suppressions" (
	"id" serial PRIMARY KEY NOT NULL,
	"guild_id" varchar(255) NOT NULL,
	"game_id" integer NOT NULL,
	"reason" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_lifecycle_suppressions_reason_check" CHECK ("channel_lifecycle_suppressions"."reason" IN ('deleted', 'unbound'))
);
--> statement-breakpoint
ALTER TABLE "channel_lifecycle_suppressions" ADD CONSTRAINT "channel_lifecycle_suppressions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_lifecycle_suppressions_guild_game_unique" ON "channel_lifecycle_suppressions" USING btree ("guild_id","game_id");--> statement-breakpoint
CREATE INDEX "idx_channel_lifecycle_suppressions_game" ON "channel_lifecycle_suppressions" USING btree ("game_id");