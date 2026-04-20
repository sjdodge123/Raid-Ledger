CREATE TABLE "community_lineup_invitees" (
	"id" serial PRIMARY KEY NOT NULL,
	"lineup_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_lineup_invitee_user" UNIQUE("lineup_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "community_lineups" ADD COLUMN "visibility" text DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "chk_community_lineups_visibility" CHECK ("visibility" IN ('public', 'private'));--> statement-breakpoint
ALTER TABLE "community_lineup_invitees" ADD CONSTRAINT "community_lineup_invitees_lineup_id_community_lineups_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_invitees" ADD CONSTRAINT "community_lineup_invitees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;