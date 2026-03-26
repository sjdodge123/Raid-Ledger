CREATE TABLE "community_lineup_match_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_match_member_user" UNIQUE("match_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_lineup_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"status" text DEFAULT 'suggested' NOT NULL,
	"threshold_met" boolean DEFAULT false NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"vote_percentage" numeric(5, 2),
	"fit_type" text,
	"linked_event_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lineup_match_game" UNIQUE("lineup_id","game_id")
);
--> statement-breakpoint
CREATE TABLE "community_lineup_schedule_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"match_id" integer NOT NULL,
	"proposed_time" timestamp NOT NULL,
	"overlap_score" numeric(5, 2),
	"suggested_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_lineup_schedule_votes" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_schedule_vote_user" UNIQUE("slot_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "consumed_intent_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"consumed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consumed_intent_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "match_threshold" SET DATA TYPE integer;--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "match_threshold" SET DEFAULT 35;--> statement-breakpoint
ALTER TABLE "community_lineups" ALTER COLUMN "match_threshold" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "community_lineup_match_members" ADD CONSTRAINT "community_lineup_match_members_match_id_community_lineup_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_match_members" ADD CONSTRAINT "community_lineup_match_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ADD CONSTRAINT "community_lineup_matches_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ADD CONSTRAINT "community_lineup_matches_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_matches" ADD CONSTRAINT "community_lineup_matches_linked_event_id_events_id_fk" FOREIGN KEY ("linked_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_slots" ADD CONSTRAINT "community_lineup_schedule_slots_match_id_community_lineup_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_votes" ADD CONSTRAINT "community_lineup_schedule_votes_slot_id_community_lineup_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."community_lineup_schedule_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_votes" ADD CONSTRAINT "community_lineup_schedule_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_consumed_intent_tokens_consumed_at" ON "consumed_intent_tokens" USING btree ("consumed_at");