CREATE INDEX "idx_event_signups_character_id" ON "event_signups" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "idx_characters_game_id" ON "characters" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_availability_source_event_id" ON "availability" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "idx_availability_game_id" ON "availability" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_event_reminders_sent_user_id" ON "event_reminders_sent" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_event_voice_sessions_user_id" ON "event_voice_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_activity_log_actor_id" ON "activity_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_player_intensity_snapshots_longest_session_game_id" ON "player_intensity_snapshots" USING btree ("longest_session_game_id");--> statement-breakpoint
CREATE INDEX "idx_player_co_play_user_id_b" ON "player_co_play" USING btree ("user_id_b");--> statement-breakpoint
CREATE INDEX "idx_lfg_intents_converted_to_event_id" ON "lfg_intents" USING btree ("converted_to_event_id");