/**
 * ROK-1941 — the companion bot posts a picture the way the Valheim mod does
 * (content line + one image attachment), and deletes what it posted.
 */
import { AttachmentBuilder } from 'discord.js';
import { getClient } from '../client.js';

/** A valid 1×1 PNG — enough for the API's sharp pipeline, no fixture file. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function sendableChannel(channelId: string) {
  const channel = await getClient().channels.fetch(channelId);
  if (!channel?.isSendable() || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a sendable text channel`);
  }
  return channel;
}

/** Post `content` with one attachment; returns the new message id. */
export async function sendWithAttachment(
  channelId: string,
  content: string,
  file: { name: string; data: Buffer },
): Promise<string> {
  const channel = await sendableChannel(channelId);
  const files = [new AttachmentBuilder(file.data, { name: file.name })];
  const msg = await channel.send({ content, files });
  return msg.id;
}

/** Delete one of the companion bot's own messages; already gone is fine. */
export async function deleteOwnMessage(
  channelId: string,
  messageId: string,
): Promise<void> {
  const channel = await sendableChannel(channelId);
  try {
    await channel.messages.delete(messageId);
  } catch (err) {
    if ((err as { code?: unknown }).code === 10008) return;
    throw err;
  }
}
