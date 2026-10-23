ALTER TABLE "community_lineups" ADD COLUMN "guild_id" integer;--> statement-breakpoint
ALTER TABLE "community_lineups" ADD CONSTRAINT "community_lineups_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_community_lineups_guild_id" ON "community_lineups" USING btree ("guild_id");