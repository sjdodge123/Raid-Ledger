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
import type { CreateNotificationInput } from './notification.types';
import {
  EVENT_NOTICE_TTL_SECONDS,
  eventNoticeKey,
  planEventNotices,
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
  /** The game copy's payload; the group copy adds `guildId`/`guildName`/`url`. */
  payload: Record<string, unknown>;
}

/** Who `sendEventNotices` writes through and claims against. */
export interface EventNoticeDeps {
  notifications: Pick<NotificationService, 'createMany'>;
  dedup: Pick<NotificationDedupService, 'checkAndMarkSentMany' | 'releaseKeys'>;
}

type Outcome = PromiseSettledResult<boolean>;

const NOT_SENT: Outcome = { status: 'fulfilled', value: false };
const SENT: Outcome = { status: 'fulfilled', value: true };

/**
 * D4/D5: plan one notice per user (group muting is already applied to
 * `group.groupIds`), claim every per-user key in one call, then write each
 * claimed notice in ONE `createMany` (ROK-2252 — was one INSERT per
 * recipient). Returns one
 * settled outcome per planned notice: `true` = created, `false` = already
 * claimed elsewhere or skipped by preferences (claim given back), rejected =
 * the claim or the batch write failed (claim given back).
 */
export async function sendEventNotices(
  deps: EventNoticeDeps,
  copy: EventNoticeCopy,
  affinityIds: readonly number[],
  group: GroupNoticeContext | null,
): Promise<Outcome[]> {
  const plan = planEventNotices({
    affinityIds,
    groupIds: group?.groupIds ?? [],
    groupMuted: new Set(),
    groupTypeOff: group?.typeOff ?? new Set(),
  });
  const claims = await claimEventNotices(deps.dedup, copy.eventId, plan);
  const won = claims.flatMap(({ notice, claim }) =>
    claim.status === 'fulfilled' && claim.value ? [notice] : [],
  );
  const sent = await createClaimedNotices(deps, copy, group, won);
  return claims.map(({ notice, claim }) => {
    if (claim.status === 'rejected' || !claim.value) return claim;
    return sent.get(notice.userId) ?? NOT_SENT;
  });
}

/**
 * Claim every planned notice's per-(user, event) key in ONE dedup call
 * (ROK-2252 — was a Redis GET + DB SELECT + INSERT per recipient); `true` =
 * this call won it. A failed claim call rejects every notice, none claimed.
 */
async function claimEventNotices(
  dedup: EventNoticeDeps['dedup'],
  eventId: number,
  plan: readonly EventNotice[],
): Promise<Array<{ notice: EventNotice; claim: Outcome }>> {
  let won: Set<string>;
  try {
    won = await dedup.checkAndMarkSentMany(
      plan.map((notice) => eventNoticeKey(eventId, notice.userId)),
      EVENT_NOTICE_TTL_SECONDS,
    );
  } catch (err: unknown) {
    return plan.map((notice) => ({ notice, claim: rejected(err) }));
  }
  return plan.map((notice) => ({
    notice,
    claim: won.has(eventNoticeKey(eventId, notice.userId)) ? SENT : NOT_SENT,
  }));
}

/**
 * One `createMany` for every claimed notice. A notice `createMany` skipped
 * (its type's in-app channel is off) or a batch that threw gives its claim
 * back, exactly as the per-notice path (`sendClaimedEventNotice`) does.
 * Outcomes are keyed by userId: valid only while `planEventNotices` plans at
 * most one notice per user.
 */
async function createClaimedNotices(
  deps: EventNoticeDeps,
  copy: EventNoticeCopy,
  group: GroupNoticeContext | null,
  won: readonly EventNotice[],
): Promise<Map<number, Outcome>> {
  if (won.length === 0) return new Map();
  let createdIds: Set<number>;
  try {
    const rows = await deps.notifications.createMany(
      won.map((notice) => buildNotice(notice, copy, group)),
    );
    createdIds = new Set(rows.map((row) => row.userId));
  } catch (err: unknown) {
    await releaseClaims(deps.dedup, copy.eventId, won);
    return new Map(
      won.map((n): [number, Outcome] => [n.userId, rejected(err)]),
    );
  }
  const skipped = won.filter((n) => !createdIds.has(n.userId));
  const release = await releaseClaims(deps.dedup, copy.eventId, skipped);
  const skippedOutcome = release.status === 'rejected' ? release : NOT_SENT;
  return new Map(
    won.map((n): [number, Outcome] => [
      n.userId,
      createdIds.has(n.userId) ? SENT : skippedOutcome,
    ]),
  );
}

/** Give back the per-user claims of `notices` in one call. */
async function releaseClaims(
  dedup: EventNoticeDeps['dedup'],
  eventId: number,
  notices: readonly EventNotice[],
): Promise<PromiseSettledResult<void>> {
  if (notices.length === 0) return { status: 'fulfilled', value: undefined };
  const keys = notices.map((n) => eventNoticeKey(eventId, n.userId));
  const [result] = await Promise.allSettled([dedup.releaseKeys(keys)]);
  return result ?? { status: 'fulfilled', value: undefined };
}

function rejected(reason: unknown): PromiseRejectedResult {
  return { status: 'rejected', reason };
}

function buildNotice(
  notice: EventNotice,
  copy: EventNoticeCopy,
  group: GroupNoticeContext | null,
): CreateNotificationInput {
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
        url: `/events/${copy.eventId}`,
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
