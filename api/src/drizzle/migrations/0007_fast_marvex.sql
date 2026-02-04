CREATE TABLE "local_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "local_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "local_admins" ADD CONSTRAINT "local_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;