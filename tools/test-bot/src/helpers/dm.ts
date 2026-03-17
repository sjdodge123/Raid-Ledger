import { ChannelType, type Message } from 'discord.js';
import { getClient } from '../client.js';
import type { SimpleMessage } from './messages.js';

// Re-use the normalizer from messages — but we need it here for DM events.
// Import toSimpleMessage is not exported, so we inline a lightweight version.
function normalize(msg: Message): SimpleMessage {
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
      return (
        row.components as Array<{
          type: { toString(): string };
          customId: string | null;
          label?: string | null;
        }>
      ).map((c) => ({
        type: c.type.toString(),
        customId: c.customId,
        label: c.label ?? null,
      }));
    }),
    timestamp: msg.createdAt,
  };
}

/**
 * Wait for a DM message matching a predicate.
 * Listens on the messageCreate event for DM channel messages.
 */
export async function waitForDM(
  predicate: (msg: SimpleMessage) => boolean,
  timeoutMs = 30_000,
): Promise<SimpleMessage> {
  const client = getClient();
  return new Promise<SimpleMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('messageCreate', handler);
      reject(new Error(`waitForDM timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(msg: Message) {
      if (msg.channel.type !== ChannelType.DM) return;
      const simple = normalize(msg);
      try {
        if (predicate(simple)) {
          clearTimeout(timer);
          client.off('messageCreate', handler);
          resolve(simple);
        }
      } catch {
        // predicate threw — not a match, keep listening
      }
    }

    client.on('messageCreate', handler);
  });
}
