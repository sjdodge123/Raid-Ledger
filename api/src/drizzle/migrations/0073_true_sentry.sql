CREATE INDEX "idx_events_recurrence_group_id" ON "events" USING btree ("recurrence_group_id");--> statement-breakpoint
CREATE INDEX "idx_events_cancelled_at" ON "events" USING btree ("cancelled_at");--> statement-breakpoint
CREATE INDEX "idx_events_discord_scheduled_event_id" ON "events" USING btree ("discord_scheduled_event_id");--> statement-breakpoint
CREATE INDEX "idx_event_signups_user_id" ON "event_signups" USING btree ("user_id");