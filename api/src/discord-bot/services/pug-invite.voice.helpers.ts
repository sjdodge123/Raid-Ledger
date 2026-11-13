/**
 * The voice an invite DM (PUG or member) points at. Routes through the shared
 * embed voice decision (`applyEmbedVoice`) so an invite sent days before an
 * ephemeral event shows the PLANNED temporary channel (operator ruling
 * 2026-11-13: every surface) instead of linking the game's default room; a
 * live temporary channel and a voice override still win exactly as before.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { applyEmbedVoice, type EmbedVoiceDeps } from './embed-voice.helpers';
import type { PlannedEphemeralVoice } from './planned-ephemeral-voice.helpers';
import { readGameName } from './scheduled-event.planned-voice';

type EventRow = typeof schema.events.$inferSelect;

export interface InviteVoice {
  voiceChannelId: string | null;
  plannedVoiceChannel: PlannedEphemeralVoice | null;
}

export interface InviteVoiceDeps extends EmbedVoiceDeps {
  db: PostgresJsDatabase<typeof schema>;
}

/** Resolve the invite's live voice channel or its planned temporary one. */
export async function resolveInviteVoice(
  deps: InviteVoiceDeps,
  event: EventRow,
  gameId: number | null,
): Promise<InviteVoice> {
  // The planned name carries the game, as the channel the scheduler creates.
  const gameName = await readGameName(deps.db, gameId);
  const target: Parameters<typeof applyEmbedVoice>[1] = {
    startTime: event.duration[0].toISOString(),
    title: event.title,
    game: gameName ? { name: gameName } : null,
  };
  await applyEmbedVoice(deps, target, {
    gameId,
    recurrenceGroupId: event.recurrenceGroupId,
    notificationChannelOverride: event.notificationChannelOverride,
    ephemeral: {
      channelId: event.ephemeralVoiceChannelId,
      enabled: event.ephemeralVoiceEnabled,
      cancelled: (event.cancelledAt ?? null) !== null,
      rescheduling: (event.reschedulingPollId ?? null) !== null,
    },
  });
  return {
    voiceChannelId: target.voiceChannelId ?? null,
    plannedVoiceChannel: target.plannedVoiceChannel ?? null,
  };
}
