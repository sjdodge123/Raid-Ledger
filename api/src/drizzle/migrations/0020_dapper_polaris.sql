CREATE TABLE "game_interests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_game_interest" UNIQUE("user_id","game_id")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "rating" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "aggregated_rating" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "popularity" real;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "game_modes" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "themes" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "platforms" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "screenshots" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "videos" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "first_release_date" timestamp;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "player_count" jsonb;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "twitch_game_id" text;--> statement-breakpoint
ALTER TABLE "game_interests" ADD CONSTRAINT "game_interests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_interests" ADD CONSTRAINT "game_interests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;