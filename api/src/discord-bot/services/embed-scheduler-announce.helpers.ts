import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';

/** The deferred-event fields the group announce needs. */
export interface DeferredAnnounceEvent {
  id: number;
  title: string;
  duration: [Date, Date];
  gameId: number | null;
  guildId: number | null;
  creatorId: number;
}

/** Collaborators for {@link announceDeferredGroupEvent}. */
export interface DeferredAnnounceDeps {
  /** Only `select` is used (the posted-embed lookup), so a drizzle mock satisfies it. */
  db: Pick<PostgresJsDatabase<typeof schema>, 'select'>;
  affinity: Pick<GameAffinityNotificationService, 'notifyGameAffinity'> | null;
  clientUrl: () => Promise<string | null>;
}

/** The posted embed's Discord message, for the notice's "View in Discord" link. */
async function findPostedMessage(
  db: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
  eventId: number,
): Promise<{ guildId: string; channelId: string; messageId: string } | null> {
  const [row] = await db
    .select({
      guildId: schema.discordEventMessages.guildId,
      channelId: schema.discordEventMessages.channelId,
      messageId: schema.discordEventMessages.messageId,
    })
    .from(schema.discordEventMessages)
    .where(eq(schema.discordEventMessages.eventId, eventId))
    .limit(1);
  return row ?? null;
}

/**
 * ROK-1832 D6a: a group-tagged event deferred past its lead-time window is
 * announced when the scheduler posts its embed. Runs the same merged plan as
 * the create path (`notifyGameAffinity`); its per-event claim keeps it
 * idempotent. Untagged deferred events keep their pre-ROK-1832 behaviour.
 */
export async function announceDeferredGroupEvent(
  deps: DeferredAnnounceDeps,
  event: DeferredAnnounceEvent,
): Promise<void> {
  if (!deps.affinity || typeof event.guildId !== 'number') return;
  const discordMessage = await findPostedMessage(deps.db, event.id);
  // Group-only: deferred events never sent game-interest notices before this
  // story, so the game fields stay null and only the group path fans out.
  await deps.affinity.notifyGameAffinity({
    eventId: event.id,
    eventTitle: event.title,
    gameName: null,
    gameId: null,
    startTime: event.duration[0].toISOString(),
    endTime: event.duration[1].toISOString(),
    creatorId: event.creatorId,
    clientUrl: await deps.clientUrl(),
    gameCoverUrl: null,
    discordMessage,
  });
}

/** The event row {@link announceGroupForEvent} announces from. */
async function findAnnounceEvent(
  db: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
  eventId: number,
): Promise<DeferredAnnounceEvent | null> {
  const e = schema.events;
  const [row] = await db
    .select({
      id: e.id,
      title: e.title,
      duration: e.duration,
      gameId: e.gameId,
      guildId: e.guildId,
      creatorId: e.creatorId,
    })
    .from(e)
    .where(eq(e.id, eventId))
    .limit(1);
  return row ?? null;
}

/**
 * ROK-1832 (Codex r3): an already group-tagged event rescheduled INTO its
 * lead-time window gets its first embed from the update path, which the
 * scheduler then never revisits. Announce its group there, from the event
 * row; the per-(user, event) claims keep a repeat a no-op.
 */
export async function announceGroupForEvent(
  deps: DeferredAnnounceDeps,
  eventId: number,
): Promise<void> {
  if (!deps.affinity) return;
  const event = await findAnnounceEvent(deps.db, eventId);
  if (event) await announceDeferredGroupEvent(deps, event);
}
