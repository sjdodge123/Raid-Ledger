ALTER TABLE "guilds" ADD COLUMN "crest_media_id" bigint;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_crest_media_id_hub_media_id_fk" FOREIGN KEY ("crest_media_id") REFERENCES "public"."hub_media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guilds_crest_media_id" ON "guilds" USING btree ("crest_media_id");