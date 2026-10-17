CREATE TABLE "refresh_family_impersonations" (
	"family_id" uuid PRIMARY KEY NOT NULL,
	"impersonator_user_id" integer NOT NULL,
	"target_user_id" integer NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_family_impersonations" ADD CONSTRAINT "refresh_family_impersonations_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_family_impersonations" ADD CONSTRAINT "refresh_family_impersonations_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refresh_family_impersonations_impersonator" ON "refresh_family_impersonations" USING btree ("impersonator_user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_family_impersonations_target" ON "refresh_family_impersonations" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_family_impersonations_expires_at" ON "refresh_family_impersonations" USING btree ("expires_at");