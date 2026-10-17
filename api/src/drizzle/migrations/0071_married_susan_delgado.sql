ALTER TABLE "events" ADD COLUMN "discord_scheduled_event_id" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_events_ad_hoc_binding" ON "events" USING btree ("channel_binding_id","is_ad_hoc");