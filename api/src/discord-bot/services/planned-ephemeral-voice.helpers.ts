/**
 * Planned ephemeral voice channel (operator ruling 2026-11-13).
 *
 * `EphemeralVoiceScheduler` creates an event's temporary voice channel only
 * once its start falls inside `[now, now + createBufferMinutes]`. Before that
 * every surface used to fall through to the game's DEFAULT voice binding, which
 * points attendees at the wrong channel. While a temporary channel is PLANNED
 * but not yet created, surfaces show its name (plain text) plus when it opens;
 * once it exists the live channel wins exactly as before.
 */
import type { SettingsService } from '../../settings/settings.service';
import { shouldCreateEphemeralChannel } from './ephemeral-voice.gate.helpers';
import { buildEphemeralChannelName } from './scheduled-event.helpers';
import type { EmbedEventData } from './discord-embed.factory';

/** The not-yet-created temporary channel: its name and when it opens (ISO). */
export interface PlannedEphemeralVoice {
  name: string;
  opensAt: string;
}

/** The three admin settings the planned-channel decision reads. */
export interface PlannedVoiceSettings {
  globalEnabled: boolean;
  forced: boolean;
  bufferMinutes: number;
}

/** The event-side inputs of the planned-channel decision. */
export interface PlannedVoiceEventFields {
  /** The event's own opt-in (`events.ephemeral_voice_enabled`). */
  eventOverride: boolean | null;
  /** The live ephemeral channel id — set once the scheduler created it. */
  liveChannelId: string | null;
  cancelled: boolean;
  /** An open reschedule poll is voting this start time away (ROK-1370). */
  rescheduling: boolean;
  startTime: Date;
  title: string;
  gameName: string | null;
}

export type PlannedEphemeralVoiceInput = PlannedVoiceSettings &
  PlannedVoiceEventFields & { now: Date };

/** The slice of `SettingsService` the loader needs (keeps specs light). */
export type PlannedVoiceSettingsSource = Pick<
  SettingsService,
  | 'getEphemeralVoiceEnabled'
  | 'getEphemeralVoiceForced'
  | 'getEphemeralVoiceCreateBufferMinutes'
>;

/**
 * Pure: the planned temporary channel, or null when none is pending.
 *
 * Planned iff the ephemeral gate says the event gets a channel, no live
 * channel exists yet, the event is not cancelled, no reschedule poll is open
 * (the scheduler skips those too) and it has not started.
 */
export function resolvePlannedEphemeralVoice(
  input: PlannedEphemeralVoiceInput,
): PlannedEphemeralVoice | null {
  const { globalEnabled, forced, eventOverride } = input;
  if (!shouldCreateEphemeralChannel(globalEnabled, forced, eventOverride))
    return null;
  if (isNeverPlanned(input)) return null;
  const startMs = input.startTime.getTime();
  if (!(input.now.getTime() < startMs)) return null;
  const opensAt = new Date(startMs - input.bufferMinutes * 60_000);
  return { name: plannedChannelName(input), opensAt: opensAt.toISOString() };
}

/** Live channel already there, cancelled, or a reschedule poll is open. */
function isNeverPlanned(event: PlannedVoiceEventFields): boolean {
  return !!event.liveChannelId || event.cancelled || event.rescheduling;
}

/** The name the scheduler will give the channel (title/game drive it). */
function plannedChannelName(input: PlannedEphemeralVoiceInput): string {
  const iso = input.startTime.toISOString();
  return buildEphemeralChannelName({
    title: input.title,
    game: input.gameName ? { name: input.gameName } : null,
    startTime: iso,
    endTime: iso,
    signupCount: 0,
  });
}

/** Read the three settings the planned-channel decision needs. */
export async function loadPlannedVoiceSettings(
  settings: PlannedVoiceSettingsSource,
): Promise<PlannedVoiceSettings> {
  const [globalEnabled, forced, bufferMinutes] = await Promise.all([
    settings.getEphemeralVoiceEnabled(),
    settings.getEphemeralVoiceForced(),
    settings.getEphemeralVoiceCreateBufferMinutes(),
  ]);
  return { globalEnabled, forced, bufferMinutes };
}

/**
 * Convenience for every surface (embeds, website, Scheduled Event): load the
 * settings and resolve. Skips the settings reads when the event can never be
 * planned (live channel already there, cancelled, rescheduling).
 */
export async function resolvePlannedVoiceForEvent(
  settings: PlannedVoiceSettingsSource,
  event: PlannedVoiceEventFields,
  now: Date = new Date(),
): Promise<PlannedEphemeralVoice | null> {
  if (isNeverPlanned(event)) return null;
  const loaded = await loadPlannedVoiceSettings(settings);
  return resolvePlannedEphemeralVoice({ ...loaded, ...event, now });
}

/** An event row's ephemeral-voice columns, as the embed paths read them. */
export interface EphemeralVoiceState {
  channelId: string | null;
  enabled: boolean | null;
  cancelled: boolean;
  rescheduling: boolean;
}

/**
 * The planned channel for an embed. Shared by BOTH embed paths (embed-poster
 * and embed-sync) so a first post and a later sync can never disagree.
 */
export function plannedVoiceForEmbed(
  settings: PlannedVoiceSettingsSource,
  event: Pick<EmbedEventData, 'startTime' | 'title' | 'game'>,
  state: EphemeralVoiceState,
  now: Date = new Date(),
): Promise<PlannedEphemeralVoice | null> {
  const fields: PlannedVoiceEventFields = {
    eventOverride: state.enabled,
    liveChannelId: state.channelId,
    cancelled: state.cancelled,
    rescheduling: state.rescheduling,
    startTime: new Date(event.startTime),
    title: event.title,
    gameName: event.game?.name ?? null,
  };
  return resolvePlannedVoiceForEvent(settings, fields, now);
}

/**
 * Set `plannedVoiceChannel` on embed data when a temporary channel is planned.
 * @returns true when set — the caller then skips the default voice binding.
 */
export async function applyPlannedVoice(
  settings: PlannedVoiceSettingsSource,
  event: Pick<EmbedEventData, 'startTime' | 'title' | 'game'> &
    Pick<EmbedEventData, 'plannedVoiceChannel'>,
  state: EphemeralVoiceState,
): Promise<boolean> {
  const planned = await plannedVoiceForEmbed(settings, event, state);
  if (!planned) return false;
  event.plannedVoiceChannel = planned;
  return true;
}
