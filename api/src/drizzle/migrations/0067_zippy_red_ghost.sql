DROP INDEX "channel_bindings_guild_channel_unique";--> statement-breakpoint
ALTER TABLE "channel_bindings" ADD COLUMN "recurrence_group_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_bindings_guild_channel_series_unique" ON "channel_bindings" USING btree ("guild_id","channel_id","recurrence_group_id");--> statement-breakpoint
CREATE INDEX "idx_channel_bindings_recurrence_group" ON "channel_bindings" USING btree ("recurrence_group_id");