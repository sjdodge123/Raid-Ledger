ALTER TABLE "community_lineup_entries" DROP CONSTRAINT "community_lineup_entries_carried_over_from_community_lineups_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" DROP CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_tiebreaker_id_community_lineup_tiebreakers_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" DROP CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_game_a_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" DROP CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_game_b_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" DROP CONSTRAINT "community_lineup_tiebreaker_bracket_matchups_winner_game_id_games_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_votes" DROP CONSTRAINT "community_lineup_tiebreaker_bracket_votes_matchup_id_community_lineup_tiebreaker_bracket_matchups_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_vetoes" DROP CONSTRAINT "community_lineup_tiebreaker_vetoes_tiebreaker_id_community_lineup_tiebreakers_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_match_members" DROP CONSTRAINT "community_lineup_match_members_match_id_community_lineup_matches_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_slots" DROP CONSTRAINT "community_lineup_schedule_slots_match_id_community_lineup_matches_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_votes" DROP CONSTRAINT "community_lineup_schedule_votes_slot_id_community_lineup_schedule_slots_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_user_submissions" DROP CONSTRAINT "community_lineup_user_submissions_lineup_id_community_lineups_id_fk";
--> statement-breakpoint
ALTER TABLE "community_lineup_entries" ADD CONSTRAINT "cl_entries_carried_over_from_fk" FOREIGN KEY ("carried_over_from") REFERENCES "public"."community_lineups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "cl_tb_bracket_matchups_tiebreaker_id_fk" FOREIGN KEY ("tiebreaker_id") REFERENCES "public"."community_lineup_tiebreakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "cl_tb_bracket_matchups_game_a_id_fk" FOREIGN KEY ("game_a_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "cl_tb_bracket_matchups_game_b_id_fk" FOREIGN KEY ("game_b_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_matchups" ADD CONSTRAINT "cl_tb_bracket_matchups_winner_game_id_fk" FOREIGN KEY ("winner_game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_bracket_votes" ADD CONSTRAINT "cl_tb_bracket_votes_matchup_id_fk" FOREIGN KEY ("matchup_id") REFERENCES "public"."community_lineup_tiebreaker_bracket_matchups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_tiebreaker_vetoes" ADD CONSTRAINT "cl_tb_vetoes_tiebreaker_id_fk" FOREIGN KEY ("tiebreaker_id") REFERENCES "public"."community_lineup_tiebreakers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_match_members" ADD CONSTRAINT "cl_match_members_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_slots" ADD CONSTRAINT "cl_schedule_slots_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."community_lineup_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_schedule_votes" ADD CONSTRAINT "cl_schedule_votes_slot_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."community_lineup_schedule_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_lineup_user_submissions" ADD CONSTRAINT "cl_user_submissions_lineup_id_fk" FOREIGN KEY ("lineup_id") REFERENCES "public"."community_lineups"("id") ON DELETE cascade ON UPDATE no action;