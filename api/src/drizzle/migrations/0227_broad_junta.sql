ALTER TABLE "guild_members" ADD COLUMN "introduced_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "guild_members" ADD COLUMN "corroborated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_introduced_by_user_id_users_id_fk" FOREIGN KEY ("introduced_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guild_members_introduced_by_user_id" ON "guild_members" USING btree ("introduced_by_user_id");