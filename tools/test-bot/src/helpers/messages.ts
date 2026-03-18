import { type Message, type TextChannel } from 'discord.js';
import { getClient, getTextChannel } from '../client.js';

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

/** Fetch the last N messages from a channel. */
export async function readLastMessages(
  channelId: string,
  count = 10,
): Promise<SimpleMessage[]> {
  const channel = getTextChannel(channelId);
  const msgs = await channel.messages.fetch({ limit: count });
  return msgs.map(toSimpleMessage).reverse(); // oldest first
}

/**
 * Wait for a message matching a predicate.
 * Resolves with the matching message, or rejects on timeout.
 */
export async function waitForMessage(
  channelId: string,
  predicate: (msg: SimpleMessage) => boolean,
  timeoutMs = 30_000,
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
      try {
        if (predicate(simple)) {
          clearTimeout(timer);
          client.off('messageCreate', handler);
          resolve(simple);
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
