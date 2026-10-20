import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type EmbedBuilder,
} from 'discord.js';
import { createChannelEmbed } from '../../discord-bot/embeds/embed-chrome.helpers';
import { markdownExcerpt } from './hub-post-markdown.helpers';

/** §2.5 visible-character budget of the relay excerpt. */
export const HUB_POST_EXCERPT_VISIBLE = 300;

/** Everything the relay embed shows. */
export interface HubPostEmbedInput {
  guildName: string;
  authorName: string | null;
  body: string;
  createdAt: Date;
  /** Absolute Posts-tab deep link (`postDeepLink`). */
  deepLink: string;
  /** Absolute client origin, for app-relative links in the body. */
  clientUrl: string;
}

/** The relay message: one embed + one "Read more" link button. */
export interface HubPostEmbed {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
}

/**
 * ROK-1868 §2.5 — the channel relay of a hub post, in the DM idiom
 * (`hub_leader_post` = done state, 📣): author line = hub name, title =
 * "New post from <author>", description = the Discord-safe excerpt. No
 * `content`, so the message never pings. Chrome (colour, author, footer)
 * comes from `createChannelEmbed` — `done` is the SYSTEM colour and the
 * footer falls back to `Raid Ledger`; the timestamp is the post's own.
 */
export function buildHubPostEmbed(input: HubPostEmbedInput): HubPostEmbed {
  const embed = createChannelEmbed({
    state: 'done',
    authorLine: `📣 ${input.guildName}`,
    timestamp: false,
  })
    .setTitle(
      input.authorName ? `New post from ${input.authorName}` : 'New post',
    )
    .setTimestamp(input.createdAt);
  const description = markdownExcerpt(input.body, {
    visible: HUB_POST_EXCERPT_VISIBLE,
    clientUrl: input.clientUrl,
  });
  if (description) embed.setDescription(description);
  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel('Read more')
    .setURL(input.deepLink);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  return { embed, row };
}
