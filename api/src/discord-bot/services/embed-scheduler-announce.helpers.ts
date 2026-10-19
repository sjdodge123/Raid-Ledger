import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { GameAffinityNotificationService } from '../../notifications/game-affinity-notification.service';
import type { EmbedGame } from './embed-game.helpers';

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
  db: PostgresJsDatabase<typeof schema>;
  affinity: GameAffinityNotificationService | null;
  clientUrl: () => Promise<string | null>;
}

/** The posted embed's Discord message, for the notice's "View in Discord" link. */
async function findPostedMessage(
  db: PostgresJsDatabase<typeof schema>,
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
  game: EmbedGame | null,
): Promise<void> {
  if (!deps.affinity || typeof event.guildId !== 'number') return;
  const discordMessage = await findPostedMessage(deps.db, event.id);
  await deps.affinity.notifyGameAffinity({
    eventId: event.id,
    eventTitle: event.title,
    gameName: game?.name ?? null,
    gameId: event.gameId,
    startTime: event.duration[0].toISOString(),
    endTime: event.duration[1].toISOString(),
    creatorId: event.creatorId,
    clientUrl: await deps.clientUrl(),
    gameCoverUrl: game?.coverUrl ?? null,
    discordMessage,
  });
}
