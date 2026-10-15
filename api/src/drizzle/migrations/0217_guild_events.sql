ALTER TABLE "events" ADD COLUMN "guild_id" integer;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_guild_id" ON "events" USING btree ("guild_id");