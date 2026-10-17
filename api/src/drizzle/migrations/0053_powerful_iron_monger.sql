CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_events_creator_id" ON "events" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "idx_events_registry_game_id" ON "events" USING btree ("registry_game_id");--> statement-breakpoint
CREATE INDEX "idx_event_signups_event_id" ON "event_signups" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_event_signups_discord_user_id" ON "event_signups" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_availability_user_id" ON "availability" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_roster_assignments_event_id" ON "roster_assignments" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_roster_assignments_signup_id" ON "roster_assignments" USING btree ("signup_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_expires_at" ON "notifications" USING btree ("expires_at");