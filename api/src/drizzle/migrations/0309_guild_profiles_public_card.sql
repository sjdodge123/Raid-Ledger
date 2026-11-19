ALTER TABLE "guild_profiles" ADD COLUMN "public_card_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_profiles" ADD COLUMN "public_card_slug" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX "guild_profiles_public_card_slug_uq" ON "guild_profiles" USING btree ("public_card_slug") WHERE "guild_profiles"."public_card_slug" IS NOT NULL;