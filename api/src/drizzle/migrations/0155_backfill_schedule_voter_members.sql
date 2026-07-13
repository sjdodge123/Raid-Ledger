-- Backfill: enroll existing schedule-poll voters as match members.
--
-- Scheduling-poll slot voting has always been open to any authenticated
-- user, but community_lineup_match_members rows were only written at poll
-- creation (creator + explicit invitees) or at from-match formation. Every
-- member-derived surface — participants list, the "N of M have voted"
-- denominator, submit-scheduling authorization (403 "Not a member of this
-- match"), reminder-cron audiences, and the availability heatmap — silently
-- excluded open-roster voters (prod incident 2026-07-13, lineup 16/match 40).
--
-- The vote path now enrolls voters at vote time; this backfills the rows for
-- votes cast before the fix. Idempotent via ON CONFLICT DO NOTHING against
-- uq_match_member_user (match_id, user_id).
INSERT INTO community_lineup_match_members (match_id, user_id, source)
SELECT DISTINCT s.match_id, v.user_id, 'voted'
FROM community_lineup_schedule_votes v
JOIN community_lineup_schedule_slots s ON s.id = v.slot_id
ON CONFLICT (match_id, user_id) DO NOTHING;
