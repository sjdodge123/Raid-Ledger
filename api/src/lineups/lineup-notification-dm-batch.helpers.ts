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
  sendMilestoneDM,
  sendMatchesFoundDM,
  sendPrivateSchedulingDM,
  sendPrivateEventCreatedDM,
} from './lineup-notification-private-dm.helpers';
import { dispatchMatchMemberDM } from './lineup-notification-dms.helpers';
import {
  findDiscordLinkedMembers,
  findDiscordMembersByUserIds,
  findInviteeDiscordMembers,
  findMatchMemberUsers,
} from './lineup-notification-targets.helpers';
import { eq } from 'drizzle-orm';
import { loadExpectedVoters } from './quorum/quorum-voters.helpers';
import {
  sendTiebreakerOpenDM,
  type TiebreakerNotificationInfo,
} from './lineup-notification-private-dm.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Fan-out voting-open DMs to all Discord-linked members. */
export async function fanOutVotingDMs(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  games: ReadonlyArray<{ id: number; name: string }>,
  baseUrl?: string,
): Promise<void> {
  const members = await findDiscordLinkedMembers(db);
  for (const member of members) {
    await sendVotingDM(
      notificationService,
      dedupService,
      lineup,
      member,
      games,
      baseUrl,
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
  baseUrl?: string,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, lineup.id);
  for (const member of members) {
    await sendVotingDM(
      notificationService,
      dedupService,
      lineup,
      member,
      games,
      baseUrl,
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

/**
 * Fan-out tiebreaker-open DMs (ROK-1117).
 *
 * Visibility-aware via `loadExpectedVoters`: public lineups DM
 * nominators ∪ voters; private lineups DM creator + invitees. We then
 * adapt those user IDs to `DiscordMember` rows (skipping users without
 * a Discord link) and reuse the shared per-user DM sender.
 */
export async function fanOutTiebreakerOpenDMs(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  tiebreaker: TiebreakerNotificationInfo,
  clientUrl?: string,
): Promise<void> {
  const [row] = await db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineup.id))
    .limit(1);
  if (!row) return;
  const userIds = await loadExpectedVoters(db, row);
  if (userIds.length === 0) return;
  const members = await findDiscordMembersByUserIds(db, userIds);
  for (const member of members) {
    await sendTiebreakerOpenDM(
      notificationService,
      dedupService,
      lineup,
      tiebreaker,
      member,
      clientUrl,
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

/**
 * Fan-out decided-phase DMs: each member of each match receives a DM
 * listing the game and their co-players on that match.
 */
export async function fanOutMatchMemberDMs(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineupId: number,
  matches: ReadonlyArray<MatchInfo>,
): Promise<void> {
  for (const match of matches) {
    const members = await findMatchMemberUsers(db, match.id);
    const names = members.map((m) => m.displayName);
    for (const member of members) {
      const coPlayers = names.filter((n) => n !== member.displayName);
      await dispatchMatchMemberDM(dedupService, notificationService, {
        matchId: match.id,
        userId: member.userId,
        gameName: match.gameName,
        coPlayers,
        lineupId,
      });
    }
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

/**
 * Fan-out milestone DMs to invitees + creator (ROK-1115).
 * Used for `visibility === 'private'` lineups so invitees still hear about
 * nomination progress even though the channel embed is suppressed.
 */
export async function fanOutMilestoneDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  threshold: number,
  entryCount: number,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, lineup.id);
  for (const member of members) {
    await sendMilestoneDM(
      notificationService,
      dedupService,
      lineup,
      threshold,
      entryCount,
      member,
    );
  }
}

/**
 * Fan-out matches-found (decided phase) DMs to invitees + creator (ROK-1115).
 */
export async function fanOutMatchesFoundDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  matchCount: number,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, lineup.id);
  for (const member of members) {
    await sendMatchesFoundDM(
      notificationService,
      dedupService,
      lineup,
      matchCount,
      member,
    );
  }
}

/**
 * Fan-out scheduling-open DMs to invitees + creator for a private lineup
 * (ROK-1115). DM body references the specific match scheduling.
 */
export async function fanOutSchedulingDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchInfo,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, match.lineupId);
  for (const member of members) {
    await sendPrivateSchedulingDM(
      notificationService,
      dedupService,
      match,
      member,
    );
  }
}

/**
 * Fan-out event-created DMs to invitees + creator for a private lineup
 * (ROK-1115).
 */
export async function fanOutEventCreatedDMsToInvitees(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  match: MatchInfo,
  eventDate: Date,
  eventId: number | undefined,
): Promise<void> {
  const members = await findInviteeDiscordMembers(db, match.lineupId);
  for (const member of members) {
    await sendPrivateEventCreatedDM(
      notificationService,
      dedupService,
      match,
      member,
      eventDate,
      eventId,
    );
  }
}
