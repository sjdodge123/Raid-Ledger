ALTER TABLE "guilds" ADD COLUMN "crest_active" varchar(8);--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "crest_upload_key" varchar(64);--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "crest_preset" jsonb;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "crest_set_by" integer;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "crest_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "crest_removed_by" integer;--> statement-breakpoint
ALTER TABLE "guilds" ADD COLUMN "crest_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_crest_set_by_users_id_fk" FOREIGN KEY ("crest_set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_crest_removed_by_users_id_fk" FOREIGN KEY ("crest_removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_guilds_crest_set_by" ON "guilds" USING btree ("crest_set_by");--> statement-breakpoint
CREATE INDEX "idx_guilds_crest_removed_by" ON "guilds" USING btree ("crest_removed_by");--> statement-breakpoint
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_crest_active_check" CHECK ("guilds"."crest_active" IS NULL OR "guilds"."crest_active" IN ('upload', 'preset'));