/**
 * ROK-1832 D4/D5/D6a — the announce-time group context and the per-notice
 * send loop behind `GameAffinityNotificationService`. Kept outside that
 * service so it stays under the file-size cap.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { NotificationService } from './notification.service';
import type { NotificationDedupService } from './notification-dedup.service';
import type { HubNotificationService } from './hub-notification.service';
import {
  planEventNotices,
  sendClaimedEventNotice,
  type EventNotice,
} from './event-notice-plan.helpers';
import {
  findEventGuildId,
  findGroupTypeOff,
  findGuildName,
} from './hub-notification.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** The event's group at send time and its (mute-filtered) recipients. */
export interface GroupNoticeContext {
  guildId: number;
  guildName: string;
  groupIds: number[];
  typeOff: Set<number>;
}

/** D6a: read `events.guild_id` now and resolve the group recipients (D3). */
export async function loadGroupNoticeContext(
  db: Db,
  hub: Pick<HubNotificationService, 'resolveGroupEventRecipients'>,
  eventId: number,
  creatorId: number,
): Promise<GroupNoticeContext | null> {
  const guildId = await findEventGuildId(db, eventId);
  if (guildId === null) return null;
  const guildName = (await findGuildName(db, guildId)) ?? 'your group';
  const groupIds = await hub.resolveGroupEventRecipients(
    eventId,
    guildId,
    creatorId,
  );
  const typeOff = await findGroupTypeOff(db, groupIds);
  return { guildId, guildName, groupIds, typeOff };
}

/** The copy each notice type carries. */
export interface EventNoticeCopy {
  eventId: number;
  title: string;
  gameName: string;
  /** The game copy's payload; the group copy adds `guildId`/`guildName`. */
  payload: Record<string, unknown>;
}

/**
 * D4/D5: plan one notice per user (group muting is already applied to
 * `group.groupIds`), then claim and send each. Settles every send.
 */
export async function sendEventNotices(
  deps: {
    notifications: Pick<NotificationService, 'create'>;
    dedup: Pick<NotificationDedupService, 'checkAndMarkSent' | 'releaseKey'>;
  },
  copy: EventNoticeCopy,
  affinityIds: readonly number[],
  group: GroupNoticeContext | null,
): Promise<PromiseSettledResult<boolean>[]> {
  const plan = planEventNotices({
    affinityIds,
    groupIds: group?.groupIds ?? [],
    groupMuted: new Set(),
    groupTypeOff: group?.typeOff ?? new Set(),
  });
  return Promise.allSettled(
    plan.map((notice) =>
      sendClaimedEventNotice(deps.dedup, copy.eventId, notice.userId, () =>
        deps.notifications.create(buildNotice(notice, copy, group)),
      ),
    ),
  );
}

function buildNotice(
  notice: EventNotice,
  copy: EventNoticeCopy,
  group: GroupNoticeContext | null,
): Parameters<NotificationService['create']>[0] {
  if (notice.type === 'hub_event_tagged' && group) {
    return {
      userId: notice.userId,
      type: 'hub_event_tagged',
      title: copy.title,
      message: `Tagged to ${group.guildName}`,
      payload: {
        ...copy.payload,
        guildId: group.guildId,
        guildName: group.guildName,
      },
    };
  }
  return {
    userId: notice.userId,
    type: 'subscribed_game',
    title: copy.title,
    message: `Based on your interest in ${copy.gameName}`,
    payload: copy.payload,
  };
}
