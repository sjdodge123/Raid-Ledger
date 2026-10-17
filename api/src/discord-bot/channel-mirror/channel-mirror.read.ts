/**
 * ROK-1788 — one uncached read of a bound channel, against a structural port.
 *
 * The port hides discord.js (see `channel-mirror.discord.ts` for the real
 * adapter) so every card state is unit-testable with a literal.
 */
import type { GuildDiscordMirrorDto } from '@raid-ledger/contract';
import {
  CHANNEL_MIRROR_FETCH_LIMIT,
  buildChannelUrl,
  classifyMirrorError,
  toGuildDiscordMessages,
  type ChannelMirrorFailure,
  type ChannelMirrorSourceMessage,
} from './channel-mirror.helpers';

/** Every mirror state except `unset`, which only the binding owner knows. */
export type ChannelMirrorRead = Exclude<
  GuildDiscordMirrorDto,
  { state: 'unset' }
>;

/** A resolved text/announcement channel, as the read needs it. */
export interface MirrorChannelPort {
  readonly id: string;
  readonly name: string;
  /** Bot has ViewChannel + ReadMessageHistory (cache-only, no REST). */
  botCanRead(): boolean;
  /** `@everyone` lacks ViewChannel (D7). */
  isPrivate(): boolean;
  /** Latest messages, any order. May throw a `DiscordAPIError`. */
  fetchLatest(limit: number): Promise<readonly ChannelMirrorSourceMessage[]>;
}

export interface ChannelMirrorReadContext {
  channelId: string;
  discordGuildId: string;
  now: Date;
  /** Called with the raw error before it is classified (logging). */
  onError?: (error: unknown) => void;
}

/** A failed fetch as its card state; a transient one carries no name. */
function toFailedRead(
  port: MirrorChannelPort,
  failure: ChannelMirrorFailure,
): ChannelMirrorRead {
  if (failure === 'disconnected') {
    return { state: 'disconnected', channelId: port.id };
  }
  return { state: failure, channelId: port.id, channelName: port.name };
}

/**
 * How long one Discord read may take before the card degrades to
 * `disconnected`. A request parked in a discord.js rate-limit queue would
 * otherwise hold every GET for the channel on the cache's shared load. The
 * timeout resolves like any transient failure, so the cache keeps it for the
 * normal TTL (the same backoff a 5xx gets).
 */
export const CHANNEL_MIRROR_READ_TIMEOUT_MS = 5_000;

class MirrorReadTimeoutError extends Error {
  constructor() {
    super(`Discord read timed out after ${CHANNEL_MIRROR_READ_TIMEOUT_MS}ms`);
  }
}

/** `work`, or a {@link MirrorReadTimeoutError} rejection once the limit passes. */
async function withReadTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new MirrorReadTimeoutError()),
      CHANNEL_MIRROR_READ_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The fetch and the mapping of a readable channel into the `ok` state. */
async function readOk(
  port: MirrorChannelPort,
  ctx: ChannelMirrorReadContext,
): Promise<ChannelMirrorRead> {
  const fetched = await withReadTimeout(
    port.fetchLatest(CHANNEL_MIRROR_FETCH_LIMIT),
  );
  return {
    state: 'ok',
    channel: {
      id: port.id,
      name: port.name,
      visibility: port.isPrivate() ? 'private' : 'public',
      url: buildChannelUrl(ctx.discordGuildId, port.id),
    },
    messages: toGuildDiscordMessages(fetched, ctx.discordGuildId),
    fetchedAt: ctx.now.toISOString(),
  };
}

/**
 * Read the bound channel once. Never throws: a missing channel is `gone`, a
 * bot without read permission is `no-access`, and a failed or slow fetch — or
 * a message the mapping cannot handle — is classified (`disconnected` unless
 * Discord said otherwise).
 *
 * @param port - The resolved channel, or null when it is not a text channel
 *   in the bot's server (deleted, or never a text channel).
 */
export async function readChannelMirror(
  port: MirrorChannelPort | null,
  ctx: ChannelMirrorReadContext,
): Promise<ChannelMirrorRead> {
  if (!port)
    return { state: 'gone', channelId: ctx.channelId, channelName: null };
  if (!port.botCanRead()) {
    return { state: 'no-access', channelId: port.id, channelName: port.name };
  }
  try {
    return await readOk(port, ctx);
  } catch (error) {
    ctx.onError?.(error);
    return toFailedRead(port, classifyMirrorError(error));
  }
}
