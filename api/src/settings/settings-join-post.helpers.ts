/**
 * ROK-1740: where the pinned "Join Raid Ledger" post lives.
 *
 * Its own module so settings-discord.helpers.ts (near the line cap) does not
 * grow. Consumers pass the SettingsService instance.
 */
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsCore } from './settings-bot.helpers';

/** The stored channel + message pair; each null when unset or blank. */
export interface JoinPostLocation {
  channelId: string | null;
  messageId: string | null;
}

/**
 * Read the stored join-post location.
 *
 * @param svc - Settings accessor.
 * @returns Channel and message ids, null when never posted.
 */
export async function getJoinPost(
  svc: SettingsCore,
): Promise<JoinPostLocation> {
  const [channelId, messageId] = await Promise.all([
    svc.get(SETTING_KEYS.DISCORD_JOIN_POST_CHANNEL_ID),
    svc.get(SETTING_KEYS.DISCORD_JOIN_POST_MESSAGE_ID),
  ]);
  return { channelId: channelId || null, messageId: messageId || null };
}

/**
 * Remember the post the bot just sent (or adopted).
 *
 * @param svc - Settings accessor.
 * @param channelId - Channel the post lives in.
 * @param messageId - The post's message id.
 */
export async function setJoinPost(
  svc: SettingsCore,
  channelId: string,
  messageId: string,
): Promise<void> {
  await svc.set(SETTING_KEYS.DISCORD_JOIN_POST_CHANNEL_ID, channelId);
  await svc.set(SETTING_KEYS.DISCORD_JOIN_POST_MESSAGE_ID, messageId);
}

/**
 * Forget the post (removed by the admin, or gone from Discord).
 *
 * @param svc - Settings accessor.
 */
export async function clearJoinPost(svc: SettingsCore): Promise<void> {
  await svc.delete(SETTING_KEYS.DISCORD_JOIN_POST_MESSAGE_ID);
  await svc.delete(SETTING_KEYS.DISCORD_JOIN_POST_CHANNEL_ID);
}
