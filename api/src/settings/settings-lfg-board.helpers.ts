/**
 * ROK-1471: LFG forum-board settings, delegated from SettingsService.
 *
 * Lives outside settings.service.ts (near the 300-line cap) in the same shape
 * as settings-discord.helpers.ts. Consumers pass the SettingsService instance.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';

/** Master toggle for the LFG forum board (default off — D1). */
export async function getLfgBoardEnabled(svc: SettingsCore): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.LFG_BOARD_ENABLED)) === 'true';
}

/** Set the LFG forum-board master toggle. */
export async function setLfgBoardEnabled(
  svc: SettingsCore,
  enabled: boolean,
): Promise<void> {
  await svc.set(SETTING_KEYS.LFG_BOARD_ENABLED, enabled ? 'true' : 'false');
}

/**
 * ROK-1612 AC6 — the composer card's opt-in. Off by default: a guild that does
 * not want a bot card pinned in its board channel never gets one.
 */
export async function getLfgComposerEnabled(
  svc: SettingsCore,
): Promise<boolean> {
  return (await svc.get(SETTING_KEYS.LFG_COMPOSER_ENABLED)) === 'true';
}

/** Set the composer card's opt-in. */
export async function setLfgComposerEnabled(
  svc: SettingsCore,
  enabled: boolean,
): Promise<void> {
  await svc.set(SETTING_KEYS.LFG_COMPOSER_ENABLED, enabled ? 'true' : 'false');
}

/** Id of the bot-created forum channel; null until one has been created (D3b). */
export async function getLfgBoardChannelId(
  svc: SettingsCore,
): Promise<string | null> {
  const value = await svc.get(SETTING_KEYS.LFG_BOARD_CHANNEL_ID);
  return value ? value : null;
}

/** Persist the id of the forum channel the bot created (or was bound to). */
export async function setLfgBoardChannelId(
  svc: SettingsCore,
  channelId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, channelId);
}

/**
 * Id of the board's intro thread; null until one has been posted (D1 enable).
 *
 * @param svc - Settings accessor.
 * @returns The thread id, or null when the intro has never been posted.
 */
export async function getLfgBoardIntroThreadId(
  svc: SettingsCore,
): Promise<string | null> {
  const value = await svc.get(SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID);
  return value ? value : null;
}

/**
 * Remember the intro thread so enabling the board twice posts it once.
 *
 * @param svc - Settings accessor.
 * @param threadId - The thread the bot just created.
 */
export async function setLfgBoardIntroThreadId(
  svc: SettingsCore,
  threadId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID, threadId);
}

/**
 * ROK-1619: the admin-configured indicator emoji, raw; null when unset.
 * Resolve it with `resolveNowIndicatorEmoji` — never render it directly.
 *
 * @param svc - Settings accessor.
 * @returns The stored value, or null when unset or blank.
 */
export async function getLfgNowIndicatorEmoji(
  svc: SettingsCore,
): Promise<string | null> {
  const value = (await svc.get(SETTING_KEYS.LFG_NOW_INDICATOR_EMOJI))?.trim();
  return value ? value : null;
}

/**
 * Store the indicator emoji; a blank value clears it back to the 🎉 default.
 *
 * @param svc - Settings accessor.
 * @param emoji - Unicode or a custom emoji reference; '' clears.
 */
export async function setLfgNowIndicatorEmoji(
  svc: SettingsCore,
  emoji: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.LFG_NOW_INDICATOR_EMOJI, emoji.trim());
}
