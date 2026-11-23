/**
 * ROK-2208 §5.2 — how an outbound post speaks: the webhook author an RL
 * person posts as, and the absolute RL link appended to the content. Split
 * from `HubForumDiscordOutboundService` (size limit); pure apart from the
 * settings read for the trusted client URL.
 */
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import type { SettingsService } from '../../../settings/settings.service';
import { toPerson, type HubPostPersonRow } from '../../posts/hub-posts.helpers';
import {
  absoluteAvatarUrl,
  forumThreadUrl,
  webhookUsername,
} from './hub-forum-discord-content';
import type { OutboundAuthor } from './hub-forum-discord-outbound.discord';

/** A thread, or one reply in it, of a hub. */
export interface OutboundRef {
  guildId: number;
  threadId: number;
  replyId?: number;
}

/** The RL page an outbound message links back to. */
export async function outboundUrl(
  settings: SettingsService,
  ref: OutboundRef,
): Promise<string> {
  return forumThreadUrl(await getClientUrl(settings), ref.guildId, ref);
}

/** A Discord-origin row's guest author columns (`discordGuestColumns`). */
export interface DiscordGuestAuthor {
  authorDiscordId: string | null;
  authorDiscordName: string | null;
  authorDiscordAvatar: string | null;
}

/**
 * ROK-2297: with no RL person, a guest's own Discord name + CDN avatar (the
 * `forumSync` URL shape). Null when the row has no guest name.
 */
export function guestVoice(guest: DiscordGuestAuthor): OutboundAuthor | null {
  const { authorDiscordId: id, authorDiscordName: name } = guest;
  if (id === null || name === null) return null;
  const hash = guest.authorDiscordAvatar;
  return {
    username: webhookUsername(name),
    avatarURL: hash
      ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`
      : null,
  };
}

/**
 * The webhook author for `row` and the RL link for `ref`. An unclaimed
 * Discord guest (`row` null) speaks as their Discord self (copied chat).
 */
export async function outboundVoice(
  settings: SettingsService,
  row: HubPostPersonRow | null,
  ref: OutboundRef,
  guest?: DiscordGuestAuthor,
): Promise<[OutboundAuthor, string]> {
  const clientUrl = await getClientUrl(settings);
  const url = forumThreadUrl(clientUrl, ref.guildId, ref);
  const asGuest = row === null && guest ? guestVoice(guest) : null;
  if (asGuest) return [asGuest, url];
  const person = toPerson(row);
  const author = {
    username: webhookUsername(person.displayName),
    avatarURL: absoluteAvatarUrl(person.avatarUrl, clientUrl),
  };
  return [author, url];
}
