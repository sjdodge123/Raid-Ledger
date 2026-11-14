/**
 * The voice a notification DM shows for an event — the SAME decision the event
 * embeds make (`applyEmbedVoice`, PR #2134): a planned (not yet created)
 * temporary channel wins with its name + open time (operator ruling
 * 2026-11-13), else the ROK-1389 voice-aware resolver picks the channel link.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { utcIsoText } from '../drizzle/timestamp-utils';
import {
  applyEmbedVoice,
  type EmbedVoiceDeps,
  type EmbedVoiceTarget,
} from '../discord-bot/services/embed-voice.helpers';
import { plannedVoiceLine } from '../discord-bot/services/discord-embed-event-body.helpers';
import type { PlannedEphemeralVoice } from '../discord-bot/services/planned-ephemeral-voice.helpers';

/** Spread into a DM payload: at most one of the two keys is set. */
export interface EventVoicePayload {
  voiceChannelId?: string;
  plannedVoiceChannel?: PlannedEphemeralVoice;
}

const VOICE_EVENT_FIELDS = {
  title: schema.events.title,
  startTime: utcIsoText(sql`lower(${schema.events.duration})`),
  gameId: schema.events.gameId,
  gameName: schema.games.name,
  recurrenceGroupId: schema.events.recurrenceGroupId,
  notificationChannelOverride: schema.events.notificationChannelOverride,
  ephemeralVoiceChannelId: schema.events.ephemeralVoiceChannelId,
  ephemeralVoiceEnabled: schema.events.ephemeralVoiceEnabled,
  cancelledAt: schema.events.cancelledAt,
  reschedulingPollId: schema.events.reschedulingPollId,
};

/** Resolve the DM voice payload for an event (`{}` when the event is gone). */
export async function resolveEventVoicePayload(
  db: PostgresJsDatabase<typeof schema>,
  deps: EmbedVoiceDeps,
  eventId: number,
): Promise<EventVoicePayload> {
  const [row] = await db
    .select(VOICE_EVENT_FIELDS)
    .from(schema.events)
    .leftJoin(schema.games, eq(schema.games.id, schema.events.gameId))
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!row) return {};
  const target: EmbedVoiceTarget = {
    startTime: row.startTime,
    title: row.title,
    game: row.gameName ? { name: row.gameName } : null,
  };
  await applyEmbedVoice(deps, target, {
    gameId: row.gameId,
    recurrenceGroupId: row.recurrenceGroupId,
    notificationChannelOverride: row.notificationChannelOverride,
    ephemeral: {
      channelId: row.ephemeralVoiceChannelId,
      enabled: row.ephemeralVoiceEnabled,
      cancelled: (row.cancelledAt ?? null) !== null,
      rescheduling: (row.reschedulingPollId ?? null) !== null,
    },
  });
  return toVoicePayload(target);
}

function toVoicePayload(target: EmbedVoiceTarget): EventVoicePayload {
  if (target.plannedVoiceChannel)
    return { plannedVoiceChannel: target.plannedVoiceChannel };
  return target.voiceChannelId ? { voiceChannelId: target.voiceChannelId } : {};
}

/** Narrow a stored DM payload value to a planned channel (else null). */
export function readPlannedVoice(value: unknown): PlannedEphemeralVoice | null {
  if (typeof value !== 'object' || value === null) return null;
  const name: unknown = Reflect.get(value, 'name');
  const opensAt: unknown = Reflect.get(value, 'opensAt');
  if (typeof name !== 'string' || typeof opensAt !== 'string') return null;
  return { name, opensAt };
}

/**
 * The DM "Voice Channel" field value: the planned line (the event embeds'
 * grammar) when a temporary channel is planned, else the `<#id>` link.
 */
export function dmVoiceFieldValue(
  payload: Record<string, unknown>,
): string | null {
  const planned = readPlannedVoice(payload.plannedVoiceChannel);
  if (planned) return plannedVoiceLine(planned);
  const id = payload.voiceChannelId;
  // A numeric id (older payloads) still renders, as `toStr` used to allow.
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  return id ? `<#${String(id)}>` : null;
}
