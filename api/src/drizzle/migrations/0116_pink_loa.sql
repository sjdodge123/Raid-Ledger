CREATE TABLE "community_lineup_tiebreaker_bracket_matchups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tiebreaker_id" integer NOT NULL,
	"round" smallint NOT NULL,
	"position" smallint NOT NULL,
	"game_a_id" integer NOT NULL,
	"game_b_id" integer,
	"winner_game_id" integer,
	"is_bye" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_tiebreaker_matchup_round_pos" UNIQUE("tiebreaker_id","round","position")
);
--> statement-breakpoint
CREATE TABLE "community_lineup_tiebreaker_bracket_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"matchup_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	CONSTRAINT "uq_tiebreaker_bracket_vote" UNIQUE("matchup_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_lineup_tiebreaker_vetoes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tiebreaker_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"revealed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_tiebreaker_veto_user" UNIQUE("tiebreaker_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_lineup_tiebreakers" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tied_game_ids" jsonb NOT NULL,
	"original_vote_count" integer NOT NULL,
	"winner_game_id" integer,
	"round_deadline" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "active_tiebreaker_id" integer;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_tiebreaker_id_community_lineup_tiebreakers_id_fk" FOREIGN KEY ("tiebreaker_id") REFERENCES "public"."community_lineup_tiebreakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_game_a_id_games_id_fk" FOREIGN KEY ("game_a_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_game_b_id_games_id_fk" FOREIGN KEY ("game_b_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_winner_game_id_games_id_fk" FOREIGN KEY ("winner_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_votes" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_votes_matchup_id_community_lineup_tiebreaker_bracket_matchups_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."community_lineup_tiebreaker_bracket_matchups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_votes" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_votes" ADD CONSTRAINT "community_lineup_tiebreaker_bracket_votes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_vetoes" ADD CONSTRAINT "community_lineup_tiebreaker_vetoes_tiebreaker_id_community_lineup_tiebreakers_id_fk" FOREIGN KEY ("tiebreaker_id") REFERENCES "public"."community_lineup_tiebreakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_vetoes" ADD CONSTRAINT "community_lineup_tiebreaker_vetoes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_vetoes" ADD CONSTRAINT "community_lineup_tiebreaker_vetoes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreakers" ADD CONSTRAINT "community_lineup_tiebreakers_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreakers" ADD CONSTRAINT "community_lineup_tiebreakers_winner_game_id_games_id_fk" FOREIGN KEY ("winner_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;