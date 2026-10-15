import { z } from 'zod';

/**
 * ROK-1740: the pinned "Join Raid Ledger" Discord post — admin wire shapes.
 *
 * The permissions the bot needs in the target channel, by their Discord UI
 * names. The admin page lists the missing ones verbatim (AC4). Pinning needs
 * Pin Messages: since 2026-02-23 Manage Messages no longer grants it.
 */
export const JOIN_POST_PERMISSION_NAMES = [
  'View Channel',
  'Send Messages',
  'Embed Links',
  'Read Message History',
  'Pin Messages',
] as const;

export type JoinPostPermissionName =
  (typeof JOIN_POST_PERMISSION_NAMES)[number];

/** `POST /admin/settings/discord-bot/join-post` body. */
export const DiscordJoinPostPublishSchema = z.object({
  channelId: z.string().min(1),
});

export type DiscordJoinPostPublishDto = z.infer<
  typeof DiscordJoinPostPublishSchema
>;

/** `GET …/join-post` — where the post lives, if anywhere. */
export interface DiscordJoinPostStatus {
  channelId: string | null;
  messageId: string | null;
}

/** `POST …/join-post` 200 body. */
export interface DiscordJoinPostResult {
  outcome: 'created' | 'edited' | 'recreated' | 'adopted';
  channelId: string;
  messageId: string;
  pinned: boolean;
  /** Set when the post landed but could not be pinned (warn, don't fail). */
  warning: string | null;
}

/** `POST …/join-post` 422 body — nothing was posted. */
export interface DiscordJoinPostMissingPermissions {
  message: string;
  missing: JoinPostPermissionName[];
}
