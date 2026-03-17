import { ChannelType, type Message } from 'discord.js';
import { getClient } from '../client.js';
import { toSimpleMessage, type SimpleMessage } from './messages.js';

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
      const simple = toSimpleMessage(msg);
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
