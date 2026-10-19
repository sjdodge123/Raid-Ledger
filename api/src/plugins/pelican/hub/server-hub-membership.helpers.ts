import {
  and,
  gt,
  gte,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { hubServerMembers } from '../../../drizzle/schema';

/** ROK-1831 L-2: a presence sighting keeps a member for this many days. */
export const SERVER_HUB_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

/** The oldest sighting that still counts at `now`. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - SERVER_HUB_WINDOW_DAYS * DAY_MS);
}

/** The membership-relevant columns of one `hub_server_members` row. */
export interface MembershipFields {
  joinedAt: Date | null;
  leftAt: Date | null;
  lastSeenAt: Date | null;
}

/**
 * ROK-1831 L-2, in memory: a manual Join not left, OR a sighting inside the
 * window that is newer than any Leave. Mirrors `serverHubMemberPredicate`.
 */
export function isServerHubMember(row: MembershipFields, now: Date): boolean {
  if (row.joinedAt !== null && row.leftAt === null) return true;
  if (row.lastSeenAt === null || row.lastSeenAt < windowStart(now)) {
    return false;
  }
  return row.leftAt === null || row.lastSeenAt > row.leftAt;
}

/** ROK-1831 L-2, in SQL — the one predicate isMember / memberGroupIds / page rows reuse. */
export function serverHubMemberPredicate(now: Date): SQL {
  const m = hubServerMembers;
  const manual = and(isNotNull(m.joinedAt), isNull(m.leftAt));
  const seen = and(
    gte(m.lastSeenAt, windowStart(now)),
    or(isNull(m.leftAt), gt(m.lastSeenAt, m.leftAt)),
  );
  return or(manual, seen) ?? sql`false`;
}
