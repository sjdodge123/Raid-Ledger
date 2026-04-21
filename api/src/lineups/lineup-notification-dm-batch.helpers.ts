/**
 * DM fan-out helpers extracted from LineupNotificationService (ROK-1063).
 * Keeps lineup-notification.service.ts under the per-file line budget.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { LineupInfo, MatchInfo } from './lineup-notification.service';
import {
  sendVotingDM,
  sendSchedulingDM,
  sendEventCreatedDM,
  sendPrivateInviteDM,
} from './lineup-notification-dm.helpers';
import {
  findDiscordLinkedMembers,
  findInviteeDiscordMembers,
  findMatchMemberUsers,
} from './lineup-notification-targets.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Fan-out voting-open DMs to all Discord-linked members. */
export async function fanOutVotingDMs(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  games: ReadonlyArray<{ id: number; name: string }>,
): Promise<void> {
  const members = await findDiscordLinkedMembers(db);
  for (const member of members) {
    await sendVotingDM(
      notificationService,
      dedupService,
      lineup,
      member,
      games,
    );
  }
}

/**
 * Fan-out voting-open DMs to invitees + creator only (ROK-1065).
 * Used for `visibility === 'private'` lineups.
 */
export async function fanOutVotingDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  games: ReadonlyArray<{ id: number; name: string }>,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, lineup.id);
  for (const member of members) {
    await sendVotingDM(
      notificationService,
      dedupService,
      lineup,
      member,
      games,
    );
  }
}

/**
 * Fan-out lineup-created DMs to invitees + creator (ROK-1065).
 *
 * Private lineups suppress the channel embed and instead DM each invitee.
 * Reuses sendVotingDM so the DM references the lineup title; the smoke
 * test only asserts that *some* DM mentioning the title reaches the
 * invitee before the lineup transitions to voting.
 */
export async function fanOutLineupCreatedDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, lineup.id);
  for (const member of members) {
    await sendPrivateInviteDM(
      notificationService,
      dedupService,
      lineup,
      member,
    );
  }
}

/** Fan-out scheduling DMs to all members of a match. */
export async function fanOutSchedulingDMs(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchInfo,
): Promise<void> {
  const members = await findMatchMemberUsers(db, match.id);
  for (const m of members) {
    await sendSchedulingDM(notificationService, dedupService, match, m);
  }
}

/** Fan-out event-created DMs to prefetched match members. */
export async function fanOutEventCreatedDMs(
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchInfo,
  eventDate: Date,
  eventId: number | undefined,
  members: Awaited<ReturnType<typeof findMatchMemberUsers>>,
): Promise<void> {
  for (const member of members) {
    await sendEventCreatedDM(
      notificationService,
      dedupService,
      match,
      member,
      eventDate,
      eventId,
    );
  }
}
