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
} from './lineup-notification-dm.helpers';
import {
  findDiscordLinkedMembers,
  findMatchMemberUsers,
} from './lineup-notification-targets.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Fan-out voting-open DMs to all Discord-linked members. */
export async function fanOutVotingDMs(
  db: Db,
  notificationService: NotificationService,
  dedupService: NotificationDedupService,
  lineup: LineupInfo,
  gameCount: number,
): Promise<void> {
  const members = await findDiscordLinkedMembers(db);
  for (const member of members) {
    await sendVotingDM(
      notificationService,
      dedupService,
      lineup,
      member,
      gameCount,
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
