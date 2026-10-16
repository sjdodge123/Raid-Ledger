/**
 * ROK-1788 L4 — body + literal builders for the guild channel-mirror DEMO seam.
 *
 * Messages are built as `ChannelMirrorSourceMessage` literals and run through
 * the SAME `toGuildDiscordMessages` pipeline a live read uses (filter, order,
 * DTO), so the card a smoke sees is the card a real channel produces.
 */
import { MessageType } from 'discord.js';
import { z } from 'zod';
import {
  buildChannelUrl,
  toGuildDiscordMessages,
  type ChannelMirrorSourceMessage,
} from '../discord-bot/channel-mirror/channel-mirror.helpers';
import type { DemoMirrorChannel } from '../discord-bot/channel-mirror/channel-mirror.demo';

/** The Discord server id used in links when no bot is connected. */
export const DEMO_DISCORD_GUILD_ID = '100000000000000001';
/** Discord's snowflake epoch (2015-01-01T00:00:00Z). */
const SNOWFLAKE_EPOCH_MS = 1_420_070_400_000n;

const DemoMessageSchema = z
  .object({
    content: z.string().max(2000),
    authorName: z.string().min(1).max(64).default('Smoke Poster'),
    embed: z
      .object({
        title: z.string().max(256).nullable(),
        description: z.string().max(2000).nullable(),
      })
      .optional(),
  })
  .strict();

export const SeedGuildDiscordChannelSchema = z
  .object({
    channelId: z.string().regex(/^\d{17,20}$/, 'channelId must be a snowflake'),
    name: z.string().min(1).max(100).default('smoke-mirror'),
    visibility: z.enum(['public', 'private']).default('public'),
    /** `no-access` / `gone` drop the channel from the picker list. */
    state: z.enum(['ok', 'no-access', 'gone']).default('ok'),
    /** Oldest first; defaults to {@link DEMO_MIRROR_MESSAGES}. */
    messages: z.array(DemoMessageSchema).max(10).optional(),
    /** Teardown: forget the channel instead of registering it. */
    remove: z.boolean().optional(),
  })
  .strict();

export type SeedGuildDiscordChannelBody = z.infer<
  typeof SeedGuildDiscordChannelSchema
>;
type DemoMessage = z.infer<typeof DemoMessageSchema>;

/** Four messages (oldest first) so the card's latest-3 slice drops one. */
export const DEMO_MIRROR_MESSAGES: readonly DemoMessage[] = [
  { content: 'Mirror smoke message one', authorName: 'Smoke Poster' },
  { content: 'Mirror smoke message two', authorName: 'Smoke Officer' },
  { content: 'Mirror smoke message three', authorName: 'Smoke Poster' },
  {
    content: 'Mirror smoke message four',
    authorName: 'Smoke Officer',
    embed: {
      title: 'Raid signups are open',
      description: 'Sign up on Raid Ledger',
    },
  },
];

/** A snowflake for a timestamp; `seq` keeps same-millisecond ids distinct. */
function snowflakeAt(ms: number, seq: number): string {
  return (((BigInt(ms) - SNOWFLAKE_EPOCH_MS) << 22n) | BigInt(seq)).toString();
}

/** One literal message, `minutesAgo` before `now`. */
function toSourceMessage(
  message: DemoMessage,
  seq: number,
  minutesAgo: number,
  now: Date,
): ChannelMirrorSourceMessage {
  const createdAt = new Date(now.getTime() - minutesAgo * 60_000);
  return {
    id: snowflakeAt(createdAt.getTime(), seq),
    content: message.content,
    createdAt,
    editedAt: null,
    author: {
      id: snowflakeAt(now.getTime(), 100 + seq),
      username: message.authorName,
      displayName: message.authorName,
      avatar: null,
      bot: false,
    },
    attachments: new Map(),
    mentions: { users: new Map(), roles: new Map(), channels: new Map() },
    type: MessageType.Default,
    system: false,
    embeds: message.embed ? [message.embed] : [],
  };
}

/** The `ok` read: the messages through the live read's own pipeline. */
function okRead(
  option: DemoMirrorChannel['option'],
  messages: readonly DemoMessage[],
  discordGuildId: string,
  now: Date,
): DemoMirrorChannel['read'] {
  const sources = messages.map((message, i) =>
    toSourceMessage(message, i, messages.length - i, now),
  );
  return {
    state: 'ok',
    channel: { ...option, url: buildChannelUrl(discordGuildId, option.id) },
    messages: toGuildDiscordMessages(sources, discordGuildId),
    fetchedAt: now.toISOString(),
  };
}

/** The fabricated channel the mirror service will serve for `body`. */
export function buildDemoChannel(
  body: SeedGuildDiscordChannelBody,
  discordGuildId: string,
  now: Date,
): DemoMirrorChannel {
  const option = {
    id: body.channelId,
    name: body.name,
    visibility: body.visibility,
  };
  if (body.state !== 'ok') {
    const read = {
      state: body.state,
      channelId: option.id,
      channelName: option.name,
    };
    return { option, read };
  }
  const messages = body.messages ?? DEMO_MIRROR_MESSAGES;
  return { option, read: okRead(option, messages, discordGuildId, now) };
}
