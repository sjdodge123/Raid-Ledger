CREATE TABLE "game_time_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_hour" smallint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_user_game_time_slot" UNIQUE("user_id","day_of_week","start_hour")
);
--> statement-breakpoint
ALTER TABLE "game_time_templates" ADD CONSTRAINT "game_time_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_time_templates_user_id_idx" ON "game_time_templates" USING btree ("user_id");