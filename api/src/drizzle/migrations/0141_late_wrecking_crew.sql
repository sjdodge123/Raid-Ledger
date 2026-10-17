CREATE TABLE "community_lineup_user_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"nominations_submitted_at" timestamp,
	"votes_submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lineup_user_submission" UNIQUE("lineup_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "community_lineup_match_members" ADD COLUMN "scheduling_submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "community_lineup_user_submissions" ADD CONSTRAINT "community_lineup_user_submissions_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_user_submissions" ADD CONSTRAINT "community_lineup_user_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;