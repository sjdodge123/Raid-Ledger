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
