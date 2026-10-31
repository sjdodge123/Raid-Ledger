CREATE TABLE "series_signups" (
	"id" serial PRIMARY KEY NOT NULL,
	"recurrence_group_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"character_id" uuid,
	"preferred_roles" text[],
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"ended_reason" varchar(30),
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "event_signups" ADD COLUMN "series_signup_id" integer;--> statement-breakpoint
ALTER TABLE "series_signups" ADD CONSTRAINT "series_signups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_signups" ADD CONSTRAINT "series_signups_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_series_signups_active" ON "series_signups" USING btree ("recurrence_group_id","user_id") WHERE "series_signups"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_series_signups_group" ON "series_signups" USING btree ("recurrence_group_id");--> statement-breakpoint
CREATE INDEX "idx_series_signups_user" ON "series_signups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_series_signups_character_id" ON "series_signups" USING btree ("character_id");--> statement-breakpoint
ALTER TABLE "event_signups" ADD CONSTRAINT "event_signups_series_signup_id_series_signups_id_fk" FOREIGN KEY ("series_signup_id") REFERENCES "public"."series_signups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_event_signups_series_signup_id" ON "event_signups" USING btree ("series_signup_id");