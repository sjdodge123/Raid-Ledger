ALTER TABLE "guild_profiles" ADD COLUMN "recruitment" jsonb;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "recruitment_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "recruitment_updated_by" integer;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD CONSTRAINT "guild_profiles_recruitment_updated_by_users_id_fk" FOREIGN KEY ("recruitment_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_profiles_recruitment_updated_by" ON "guild_profiles" USING btree ("recruitment_updated_by");