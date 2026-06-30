/**
 * Discord bot convenience helpers delegated from SettingsService.
 * These are simple get/set wrappers for individual Discord-related setting keys.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';

/** Get the default text channel ID for the Discord bot. */
export async function getDiscordBotDefaultChannel(
  svc: SettingsCore,
): Promise<string | null> {
  return svc.get(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL);
}

/** Set the default text channel ID for the Discord bot. */
export async function setDiscordBotDefaultChannel(
  svc: SettingsCore,
  channelId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL, channelId);
}

/** Check if the Discord bot setup wizard has been completed. */
export async function isDiscordBotSetupCompleted(
  svc: SettingsCore,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED)) === 'true';
}

/** Mark the Discord bot setup wizard as completed. */
export async function markDiscordBotSetupCompleted(
  svc: SettingsCore,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_BOT_SETUP_COMPLETED, 'true');
}

/** Get the Discord bot community name. */
export async function getDiscordBotCommunityName(
  svc: SettingsCore,
): Promise<string | null> {
  return svc.get(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME);
}

/** Set the Discord bot community name. */
export async function setDiscordBotCommunityName(
  svc: SettingsCore,
  name: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_BOT_COMMUNITY_NAME, name);
}

/** Get the Discord bot timezone. */
export async function getDiscordBotTimezone(
  svc: SettingsCore,
): Promise<string | null> {
  return svc.get(SETTING_KEYS.DISCORD_BOT_TIMEZONE);
}

/** Set the Discord bot timezone. */
export async function setDiscordBotTimezone(
  svc: SettingsCore,
  timezone: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_BOT_TIMEZONE, timezone);
}

/** Get the default timezone for events. */
export async function getDefaultTimezone(
  svc: SettingsCore,
): Promise<string | null> {
  return svc.get(SETTING_KEYS.DEFAULT_TIMEZONE);
}

/** Set the default timezone for events. */
export async function setDefaultTimezone(
  svc: SettingsCore,
  timezone: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DEFAULT_TIMEZONE, timezone);
}

/** Get the lineup channel ID for the Discord bot (ROK-932). */
export async function getDiscordBotLineupChannel(
  svc: SettingsCore,
): Promise<string | null> {
  return svc.get(SETTING_KEYS.DISCORD_BOT_LINEUP_CHANNEL);
}

/** Set the lineup channel ID for the Discord bot (ROK-932). */
export async function setDiscordBotLineupChannel(
  svc: SettingsCore,
  channelId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_BOT_LINEUP_CHANNEL, channelId);
}

/** Get the default voice channel ID for the Discord bot. */
export async function getDiscordBotDefaultVoiceChannel(
  svc: SettingsCore,
): Promise<string | null> {
  return svc.get(SETTING_KEYS.DISCORD_BOT_DEFAULT_VOICE_CHANNEL);
}

/** Set the default voice channel ID for the Discord bot. */
export async function setDiscordBotDefaultVoiceChannel(
  svc: SettingsCore,
  channelId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_BOT_DEFAULT_VOICE_CHANNEL, channelId);
}

// ─── ROK-1352: Ephemeral voice channels ──────────────────────────

/** Master toggle for ephemeral voice channels (default off). */
export async function getEphemeralVoiceEnabled(
  svc: SettingsCore,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.EPHEMERAL_VOICE_ENABLED)) === 'true';
}

/** Set the ephemeral-voice master toggle. */
export async function setEphemeralVoiceEnabled(
  svc: SettingsCore,
  enabled: boolean,
): Promise<void> {
  await svc.set(
    SETTING_KEYS.EPHEMERAL_VOICE_ENABLED,
    enabled ? 'true' : 'false',
  );
}

/** Force-ephemeral: every managed event gets a channel (default off). */
export async function getEphemeralVoiceForced(
  svc: SettingsCore,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.EPHEMERAL_VOICE_FORCED)) === 'true';
}

/** Set the force-ephemeral toggle. */
export async function setEphemeralVoiceForced(
  svc: SettingsCore,
  forced: boolean,
): Promise<void> {
  await svc.set(SETTING_KEYS.EPHEMERAL_VOICE_FORCED, forced ? 'true' : 'false');
}

/** Parent category ID under which ephemeral channels are created (null = guild root). */
export async function getEphemeralVoiceCategoryId(
  svc: SettingsCore,
): Promise<string | null> {
  const v = await svc.get(SETTING_KEYS.EPHEMERAL_VOICE_CATEGORY_ID);
  return v && v.length > 0 ? v : null;
}

/** Set the ephemeral-voice parent category (empty string clears it). */
export async function setEphemeralVoiceCategoryId(
  svc: SettingsCore,
  categoryId: string | null,
): Promise<void> {
  await svc.set(SETTING_KEYS.EPHEMERAL_VOICE_CATEGORY_ID, categoryId ?? '');
}

/** Minutes before event start to create the channel (default 30). */
export async function getEphemeralVoiceCreateBufferMinutes(
  svc: SettingsCore,
): Promise<number> {
  const v = await svc.get(SETTING_KEYS.EPHEMERAL_VOICE_CREATE_BUFFER_MINUTES);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** Set the create-buffer minutes. */
export async function setEphemeralVoiceCreateBufferMinutes(
  svc: SettingsCore,
  minutes: number,
): Promise<void> {
  await svc.set(
    SETTING_KEYS.EPHEMERAL_VOICE_CREATE_BUFFER_MINUTES,
    String(minutes),
  );
}

/** Minutes a channel must sit empty post-event before delete (default 30). */
export async function getEphemeralVoiceIdleMinutes(
  svc: SettingsCore,
): Promise<number> {
  const v = await svc.get(SETTING_KEYS.EPHEMERAL_VOICE_IDLE_MINUTES);
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** Set the idle-window minutes. */
export async function setEphemeralVoiceIdleMinutes(
  svc: SettingsCore,
  minutes: number,
): Promise<void> {
  await svc.set(SETTING_KEYS.EPHEMERAL_VOICE_IDLE_MINUTES, String(minutes));
}
