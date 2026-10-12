/**
 * The "genuinely votable standalone poll" predicate, shared by the events-page
 * banner (`findActiveStandalonePolls`) and the weekly digest's "Coming up"
 * section (ROK-1771 D2), so the two cannot drift apart.
 *
 * ROK-1609: `m.status = 'scheduling'` alone kept advertising polls that every
 * other surface already calls expired. A poll is votable only while the
 * lineup is not archived, the deadline (when it has one) is still ahead, and
 * — per ROK-1607 — at least one proposed time is still in the future. A poll
 * with no slots yet stays votable: suggesting a time is the point of it. The
 * conditions mirror `pollStatusFromMatch`, so the banner, the poll page and
 * the Discord card agree on what "open" means.
 *
 * Viewer-free: visibility is the caller's concern. Expects the aliases
 * `m` = `community_lineup_matches` and `l` = `community_lineups`.
 */
import { sql, type SQL } from 'drizzle-orm';

export function votableStandalonePollSql(): SQL {
  return sql`m.status = 'scheduling'
      AND l.phase_duration_override->>'standalone' = 'true'
      AND (l.status IS NULL OR l.status <> 'archived')
      AND (l.phase_deadline IS NULL OR l.phase_deadline > NOW())
      AND (
        NOT EXISTS (
          SELECT 1 FROM community_lineup_schedule_slots s
          WHERE s.match_id = m.id
        )
        OR EXISTS (
          SELECT 1 FROM community_lineup_schedule_slots s
          WHERE s.match_id = m.id AND s.proposed_time > NOW()
        )
      )`;
}
