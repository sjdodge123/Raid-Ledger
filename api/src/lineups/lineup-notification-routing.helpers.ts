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
import type { LineupInfo, MatchInfo } from './lineup-notification.service';
import {
  fanOutLineupCreatedDMsToInvitees,
  fanOutVotingDMsToInvitees,
  fanOutMilestoneDMsToInvitees,
  fanOutMatchesFoundDMsToInvitees,
  fanOutSchedulingDMsToInvitees,
  fanOutEventCreatedDMsToInvitees,
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

/**
 * Private-branch dispatch for `notifyNominationMilestone` (ROK-1115):
 * DM invitees about the milestone and skip the channel embed.
 */
export async function routeNominationMilestoneIfPrivate(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  threshold: number,
  entryCount: number,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(db, lineup);
  if (visibility !== 'private') return false;
  await fanOutMilestoneDMsToInvitees(
    db,
    notificationService,
    dedupService,
    lineup,
    threshold,
    entryCount,
  );
  return true;
}

/**
 * Private-branch dispatch for `notifyMatchesFound` decided-tier embed
 * (ROK-1115): DM invitees with the matches summary and skip the channel
 * embed.
 */
export async function routeMatchesFoundIfPrivate(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  matchCount: number,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(db, lineup);
  if (visibility !== 'private') return false;
  await fanOutMatchesFoundDMsToInvitees(
    db,
    notificationService,
    dedupService,
    lineup,
    matchCount,
  );
  return true;
}

/**
 * Private-branch dispatch for `notifySchedulingOpen` (ROK-1115): DM invitees
 * about the scheduling-open match and skip the per-match channel embed.
 */
export async function routeSchedulingOpenIfPrivate(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  match: MatchInfo,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(db, lineup);
  if (visibility !== 'private') return false;
  await fanOutSchedulingDMsToInvitees(
    db,
    notificationService,
    dedupService,
    match,
  );
  return true;
}

/**
 * Private-branch dispatch for `notifyEventCreated` (ROK-1115): DM invitees
 * about the locked-in event and skip the channel embed.
 */
export async function routeEventCreatedIfPrivate(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  match: MatchInfo,
  eventDate: Date,
  eventId: number | undefined,
): Promise<boolean> {
  const visibility = await resolveLineupVisibility(db, lineup);
  if (visibility !== 'private') return false;
  await fanOutEventCreatedDMsToInvitees(
    db,
    notificationService,
    dedupService,
    match,
    eventDate,
    eventId,
  );
  return true;
}
