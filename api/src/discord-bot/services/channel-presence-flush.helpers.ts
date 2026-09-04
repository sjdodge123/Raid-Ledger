/**
 * ROK-1446 D5/D8 — the pieces one presence flush is assembled from.
 *
 * Split out of `channel-presence-flush.ts` for the 300-line cap and because
 * every function here is independently assertable: the render pair, the D5
 * payload hash, the recap hydration and the D8 close predicate.
 */
import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { ResolvedBinding } from '../listeners/voice-state.helpers';
import type { ChannelEmbed } from '../embeds/embed-chrome.helpers';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import { buildChannelPresenceEmbeds } from './channel-presence-embed.helpers';
import { buildRecapEmbeds } from './channel-presence-embed.recap.helpers';
import type { RecapInput } from './channel-presence-embed.recap.helpers';
import { applyBudget } from './channel-presence-embed.budget.helpers';
import type { ResolvedRoom } from './channel-presence-room.helpers';
import { recapEvents } from './channel-presence-room.helpers';
import {
  buildEmbedEventData,
  type AdHocNotificationDeps,
  type AdHocParticipant,
} from './ad-hoc-notification.helpers';

/** Default empty-room grace, in minutes, when the binding sets none (D8). */
export const DEFAULT_GRACE_MINUTES = 5;

const MS_PER_MINUTE = 60_000;

/**
 * A stable fingerprint of the message about to be sent (D5's dirty check).
 *
 * Hashes the serialised embed array — field ORDER included, because a render
 * that reorders two groups is a visible change and must still issue an edit.
 * `EmbedBuilder.toJSON()` is the exact object handed to Discord, so anything
 * the user can see is inside the hash and anything they cannot is not.
 *
 * @param embeds - The rendered message.
 * @returns A hex sha1, sized to the row's `payload_hash varchar(64)`.
 */
export function payloadHashOf(embeds: readonly ChannelEmbed[]): string {
  const payload = JSON.stringify(embeds.map((embed) => embed.toJSON()));
  return createHash('sha1').update(payload).digest('hex');
}

/**
 * Render the live room inside Discord's limits (D2/D3/D11).
 *
 * @param room - The room as this flush resolved it.
 * @param context - Community name, client URL and timezone.
 * @param openedAt - The row's `opened_at`; the lead embed's timestamp (D3).
 * @param now - Epoch ms this flush renders at.
 * @returns Lead embed first, then one embed per group, at most ten.
 */
export function renderLiveMessage(
  room: ResolvedRoom,
  context: EmbedContext,
  openedAt: Date,
  now: number,
): ChannelEmbed[] {
  return applyBudget((cap) =>
    buildChannelPresenceEmbeds(room, context, now, openedAt, cap),
  );
}

/**
 * Render the recap the same message becomes when the room empties (D8/D11).
 *
 * @param input - Channel name, hydrated sessions and the row's `opened_at`.
 * @param context - Community name, client URL and timezone.
 * @param now - Epoch ms; a session still live is reported as ending here.
 * @returns The grey lead embed followed by one ENDED embed per session.
 */
export function renderRecapMessage(
  input: RecapInput,
  context: EmbedContext,
  now: number,
): ChannelEmbed[] {
  return applyBudget((cap) => buildRecapEmbeds(input, context, now, cap));
}

/**
 * The stored roster of one finished session, leavers kept (ROK-1243).
 *
 * The recap reads `ad_hoc_participants` directly rather than unioning live
 * voice members the way an evented group does: by definition nobody is in the
 * room any more, so the DB is the only truth left.
 */
async function recapParticipants(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<AdHocParticipant[]> {
  const rows = await db
    .select({
      discordUserId: schema.adHocParticipants.discordUserId,
      discordUsername: schema.adHocParticipants.discordUsername,
      leftAt: schema.adHocParticipants.leftAt,
    })
    .from(schema.adHocParticipants)
    .where(eq(schema.adHocParticipants.eventId, eventId));
  return rows.map((row) => ({
    discordUserId: row.discordUserId,
    discordUsername: row.discordUsername,
    isActive: !row.leftAt,
  }));
}

/**
 * Hydrate every ad-hoc session this message has covered since it opened (D8).
 *
 * @param deps - Database plus the binding/channel/settings services.
 * @param bindingId - `null` once the binding was deleted; there is then no way
 *   to find the sessions, and the recap degrades to "No session started."
 * @param openedAt - The row's `opened_at`; sessions older than it belong to a
 *   previous, already-closed message.
 * @returns Embed data per session, in the order `recapEvents` returned them.
 */
export async function hydrateRecap(
  deps: AdHocNotificationDeps,
  bindingId: string | null,
  openedAt: Date,
): Promise<EmbedEventData[]> {
  if (!bindingId) return [];
  const events = await recapEvents(deps.db, bindingId, openedAt);
  const hydrated = await Promise.all(
    events.map((event) =>
      recapParticipants(deps.db, event.id).then((participants) =>
        buildEmbedEventData(deps, event.id, participants),
      ),
    ),
  );
  return hydrated.filter((data): data is EmbedEventData => data !== null);
}

/**
 * The binding's empty-room grace in milliseconds (D8).
 *
 * Floored at one minute deliberately: a binding configured with
 * `gracePeriod: 0` would otherwise close the message on the same flush that
 * first saw the room empty, so a five-second blip would end the session and
 * the next rejoin would post a second message.
 */
export function graceMs(config: ResolvedBinding['config']): number {
  return (
    Math.max(1, config?.gracePeriod ?? DEFAULT_GRACE_MINUTES) * MS_PER_MINUTE
  );
}

/**
 * Is this row done (D8)? BOTH clauses must hold.
 *
 * @param emptySince - When the room was first seen empty.
 * @param grace - `graceMs` for the owning binding.
 * @param now - Epoch ms of this flush.
 * @param liveEvents - Sessions still `live` or `grace_period` under the
 *   binding. A non-empty list keeps the message open even past the grace, so a
 *   session that outlives the room still folds its completion into this
 *   message rather than posting anywhere else.
 */
export function isCloseDue(
  emptySince: Date | null,
  grace: number,
  now: number,
  liveEvents: readonly unknown[],
): boolean {
  if (!emptySince) return false;
  if (liveEvents.length > 0) return false;
  return emptySince.getTime() + grace <= now;
}
