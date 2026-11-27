CREATE TABLE "user_auth_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(16) NOT NULL,
	"subject" varchar(255) NOT NULL,
	"email" varchar(320),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "user_auth_identities_provider_chk" CHECK ("user_auth_identities"."provider" IN ('google'))
);
--> statement-breakpoint
ALTER TABLE "user_auth_identities" ADD CONSTRAINT "user_auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_auth_identities_provider_subject_uq" ON "user_auth_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "user_auth_identities_user_id_provider_uq" ON "user_auth_identities" USING btree ("user_id","provider");