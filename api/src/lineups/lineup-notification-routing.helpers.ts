/**
 * Visibility-routing helpers for LineupNotificationService (ROK-1065).
 * Extracted to keep lineup-notification.service.ts under the 300-line ESLint ceiling.
 *
 * Private lineups suppress the channel embed and instead DM each invitee
 * (plus the creator). These helpers centralize the `resolveVisibility`
 * DB probe and the DM fan-out short-circuit used by `notifyLineupCreated`
 * and `notifyVotingOpen`.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { LineupInfo } from './lineup-notification.service';
import {
  fanOutLineupCreatedDMsToInvitees,
  fanOutVotingDMsToInvitees,
} from './lineup-notification-dm-batch.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Resolve lineup visibility: prefer the caller-provided value, fall back
 * to a DB lookup so older callers aren't broken (ROK-1065).
 */
export async function resolveLineupVisibility(
  db: Db,
  lineup: LineupInfo,
): Promise<'public' | 'private'> {
  if (lineup.visibility) return lineup.visibility;
  const [row] = await db
    .select({ visibility: schema.communityLineups.visibility })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineup.id))
    .limit(1);
  return row?.visibility ?? 'public';
}

/**
 * Private-branch dispatch for `notifyLineupCreated`: DM invitees and skip
 * the channel embed. Returns true if the private path was taken.
 */
export async function routeLineupCreatedIfPrivate(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(db, lineup);
  if (visibility !== 'private') return false;
  await fanOutLineupCreatedDMsToInvitees(
    db,
    notificationService,
    dedupService,
    lineup,
  );
  return true;
}

/**
 * Private-branch dispatch for `notifyVotingOpen`: DM invitees with the
 * voting game list and skip the channel embed. Returns true if the
 * private path was taken.
 */
export async function routeVotingOpenIfPrivate(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  games: ReadonlyArray<{ id: number; name: string }>,
  baseUrl: string | undefined,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(db, lineup);
  if (visibility !== 'private') return false;
  await fanOutVotingDMsToInvitees(
    db,
    notificationService,
    dedupService,
    lineup,
    games,
    baseUrl,
  );
  return true;
}
