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
 * Id of the pinned intro ("read me") forum post, or null when the board has
 * never been seeded.
 *
 * Stored so that enabling the board twice does not post a second intro: the
 * toggle listener resolves this id against the forum and only creates one when
 * it no longer names a live thread (D3).
 *
 * @param svc - Settings accessor.
 * @returns The stored thread id, or null when unset or blank.
 */
export async function getLfgBoardIntroThreadId(
  svc: SettingsCore,
): Promise<string | null> {
  const value = await svc.get(SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID);
  return value ? value : null;
}

/**
 * Persist the id of the intro forum post the bot created.
 *
 * @param svc - Settings accessor.
 * @param threadId - Discord thread (forum post) id.
 */
export async function setLfgBoardIntroThreadId(
  svc: SettingsCore,
  threadId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.LFG_BOARD_INTRO_THREAD_ID, threadId);
}
