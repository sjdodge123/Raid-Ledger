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

/** The webhook author for `row` and the RL link for `ref`. */
export async function outboundVoice(
  settings: SettingsService,
  row: HubPostPersonRow | null,
  ref: OutboundRef,
): Promise<[OutboundAuthor, string]> {
  const clientUrl = await getClientUrl(settings);
  const person = toPerson(row);
  const author = {
    username: webhookUsername(person.displayName),
    avatarURL: absoluteAvatarUrl(person.avatarUrl, clientUrl),
  };
  return [author, forumThreadUrl(clientUrl, ref.guildId, ref)];
}
