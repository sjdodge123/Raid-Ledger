CREATE TABLE "valheim_profile_skill_days" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"profile_id" integer NOT NULL,
	"play_date" date NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"start_skills" jsonb NOT NULL,
	"end_skills" jsonb NOT NULL,
	CONSTRAINT "valheim_profile_skill_days_profile_date_uq" UNIQUE("profile_id","play_date")
);
--> statement-breakpoint
ALTER TABLE "valheim_profile_skill_days" ADD CONSTRAINT "valheim_profile_skill_days_profile_id_valheim_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."valheim_profiles"("id") ON DELETE cascade ON UPDATE no action;