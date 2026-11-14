/**
 * The ONE voice decision for every event embed render (first post, embed-sync,
 * and the event-update re-render): a planned (not yet created) temporary
 * channel wins (operator ruling 2026-11-13), else the ROK-1389 voice-aware
 * resolver picks the "Join Voice" link. An explicit voice override beats both
 * — it beats the live temporary channel too, so it must never be "planned".
 */
import type { ChannelResolverService } from './channel-resolver.service';
import type { EmbedEventData } from './discord-embed.factory';
import {
  applyPlannedVoice,
  hasVoiceOverride,
  type EphemeralVoiceState,
  type PlannedVoiceSettingsSource,
} from './planned-ephemeral-voice.helpers';

export interface EmbedVoiceDeps {
  /** Absent → never planned (callers without settings keep the old link). */
  settings?: PlannedVoiceSettingsSource | undefined;
  channelResolver: Pick<
    ChannelResolverService,
    'resolveVoiceChannelHonoringOverride' | 'overrideIsVoiceChannel'
  >;
}

/** The embed-data slice the decision reads (title/start/game) and writes. */
export type EmbedVoiceTarget = Pick<
  EmbedEventData,
  'startTime' | 'title' | 'game' | 'plannedVoiceChannel' | 'voiceChannelId'
>;

/** The event-row inputs of the embed voice decision. */
export interface EmbedVoiceRow {
  gameId?: number | null | undefined;
  recurrenceGroupId?: string | null | undefined;
  notificationChannelOverride?: string | null | undefined;
  /** Absent → never planned and no live temporary channel. */
  ephemeral?: EphemeralVoiceState | undefined;
}

/** Set `plannedVoiceChannel` or `voiceChannelId` on the embed data. */
export async function applyEmbedVoice(
  deps: EmbedVoiceDeps,
  eventData: EmbedVoiceTarget,
  row: EmbedVoiceRow,
): Promise<void> {
  const override = row.notificationChannelOverride;
  if (deps.settings && row.ephemeral) {
    const voiceOverride = hasVoiceOverride(deps.channelResolver, override);
    const planned = await applyPlannedVoice(
      deps.settings,
      eventData,
      row.ephemeral,
      voiceOverride,
    );
    if (planned) return;
  }
  const voiceChannelId =
    await deps.channelResolver.resolveVoiceChannelHonoringOverride(
      row.gameId,
      row.recurrenceGroupId,
      row.ephemeral ? row.ephemeral.channelId : null,
      override,
    );
  if (voiceChannelId) eventData.voiceChannelId = voiceChannelId;
}
