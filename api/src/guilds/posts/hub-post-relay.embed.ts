import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { EMBED_COLORS } from '../../discord-bot/discord-bot.constants';
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
 * `content`, so the message never pings.
 */
export function buildHubPostEmbed(input: HubPostEmbedInput): HubPostEmbed {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLORS.SYSTEM)
    .setAuthor({ name: `📣 ${input.guildName}` })
    .setTitle(
      input.authorName ? `New post from ${input.authorName}` : 'New post',
    )
    .setFooter({ text: 'Raid Ledger' })
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
