CREATE TABLE "community_lineup_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"nominated_by" integer NOT NULL,
	"note" text,
	"carried_over_from" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lineup_entry_game" UNIQUE("lineup_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "community_lineup_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"rank" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lineup_vote_user_game" UNIQUE("lineup_id","user_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "community_lineups" (
	"id" serial PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"target_date" timestamp,
	"decided_game_id" integer,
	"linked_event_id" integer,
	"created_by" integer NOT NULL,
	"voting_deadline" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_lineup_entries" ADD CONSTRAINT "community_lineup_entries_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_entries" ADD CONSTRAINT "community_lineup_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_entries" ADD CONSTRAINT "community_lineup_entries_nominated_by_users_id_fk" FOREIGN KEY ("nominated_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_entries" ADD CONSTRAINT "community_lineup_entries_carried_over_from_community_lineups_id_fk" FOREIGN KEY ("carried_over_from") REFERENCES "public"."community_lineups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_votes" ADD CONSTRAINT "community_lineup_votes_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_votes" ADD CONSTRAINT "community_lineup_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_votes" ADD CONSTRAINT "community_lineup_votes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_decided_game_id_games_id_fk" FOREIGN KEY ("decided_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_linked_event_id_events_id_fk" FOREIGN KEY ("linked_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;