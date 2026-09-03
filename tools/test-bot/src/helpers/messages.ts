import { type Message, type TextChannel } from 'discord.js';
import { getClient, getTextChannel } from '../client.js';
import { sweepRenderRules, type RenderRuleOptions } from '../smoke/assert.js';
import { filterByApiBot, shouldAcceptMessage } from './bot-author.js';

export interface SimpleMessage {
  id: string;
  authorId: string;
  authorTag: string;
  content: string;
  embeds: SimpleEmbed[];
  components: SimpleComponent[];
  timestamp: Date;
  editedAt: Date | null;
}

export interface SimpleEmbed {
  title: string | null;
  /** Embed author name — the shared chrome's community line (ROK-1459). */
  author: string | null;
  description: string | null;
  color: number | null;
  fields: { name: string; value: string; inline: boolean }[];
  footer: string | null;
  thumbnail: string | null;
  timestamp: string | null;
}

export interface SimpleComponent {
  type: string;
  customId: string | null;
  label: string | null;
}

/** Convert a discord.js Message to a plain-object SimpleMessage. */
export function toSimpleMessage(msg: Message): SimpleMessage {
  return {
    id: msg.id,
    authorId: msg.author.id,
    authorTag: msg.author.tag,
    content: msg.content,
    embeds: msg.embeds.map((e) => ({
      title: e.title,
      author: e.author?.name ?? null,
      description: e.description,
      color: e.color,
      fields: e.fields.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline ?? false,
      })),
      footer: e.footer?.text ?? null,
      thumbnail: e.thumbnail?.url ?? null,
      timestamp: e.timestamp,
    })),
    components: msg.components.flatMap((row) => {
      if (!('components' in row)) return [];
      return (row.components as Array<{ type: { toString(): string }; customId: string | null; label?: string | null }>).map((c) => ({
        type: c.type.toString(),
        customId: c.customId,
        label: c.label ?? null,
      }));
    }),
    timestamp: msg.createdAt,
    editedAt: msg.editedAt,
  };
}

/** Options for {@link readLastMessages}. */
export interface ReadOptions {
  /**
   * ROK-1469: bypass the API-bot author filter and return EVERY author's
   * messages. Only for reads that are not assertions about the app's output
   * (channel-permission probes, debugging dumps).
   */
  allAuthors?: boolean;
}

/**
 * Fetch the last N messages from a channel, oldest first.
 *
 * ROK-1469: results are pinned to the API bot the env under test is running
 * as, so a SIBLING fleet env posting the same embed into the same guild can
 * never satisfy this env's assertion. No-op when the id is unresolved.
 */
export async function readLastMessages(
  channelId: string,
  count = 10,
  opts?: ReadOptions,
): Promise<SimpleMessage[]> {
  const channel = getTextChannel(channelId);
  const msgs = await channel.messages.fetch({ limit: count });
  const simple = msgs.map(toSimpleMessage).reverse(); // oldest first
  return opts?.allAuthors ? simple : filterByApiBot(simple);
}

/**
 * Wait for a message matching a predicate.
 * Resolves with the matching message, or rejects on timeout.
 */
export async function waitForMessage(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  timeoutMs = 30_000,
  opts?: RenderRuleOptions,
): Promise<SimpleMessage> {
  const client = getClient();
  return new Promise<SimpleMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('messageCreate', handler);
      reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(msg: Message) {
      if (msg.channelId !== channelId) return;
      const simple = toSimpleMessage(msg);
      // ROK-1469 (review M6): a sibling fleet env's bot posting into this
      // channel must not satisfy the wait. Fail-open when no id is pinned.
      if (!shouldAcceptMessage(simple)) return;
      try {
        if (predicate(simple)) {
          clearTimeout(timer);
          client.off('messageCreate', handler);
          // ROK-1466: a render-rule violation rejects (the catch below) rather
          // than throwing inside the listener, where it would surface as a
          // timeout instead of naming the offending token.
          resolve(sweepRenderRules(simple, opts));
        }
      } catch (err) {
        clearTimeout(timer);
        client.off('messageCreate', handler);
        reject(err);
      }
    }

    client.on('messageCreate', handler);
  });
}

/**
 * Read recent DMs between the test bot and a specific user.
 * Bots cannot browse their own DM inbox — you must specify which user's
 * DM channel to read from.
 */
export async function readDMs(
  userId: string,
  count = 10,
): Promise<SimpleMessage[]> {
  const client = getClient();
  if (!userId) throw new Error('userId is required — bots cannot read their own DM inbox');

  const user = await client.users.fetch(userId);
  const dmChannel = await user.createDM();
  const msgs = await dmChannel.messages.fetch({ limit: count });
  return msgs.map(toSimpleMessage).reverse();
}
