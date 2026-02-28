CREATE TABLE "game_interest_suppressions" (
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"suppressed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_game_suppression" UNIQUE("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "game_interest_suppressions" ADD CONSTRAINT "game_interest_suppressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_interest_suppressions" ADD CONSTRAINT "game_interest_suppressions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;