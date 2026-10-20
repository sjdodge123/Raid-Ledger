/**
 * Typed errors for the channel-lifecycle Discord ops (ROK-1431, spec ROK-1428
 * §2.9 + D14). The reconcile (L5) branches on these classes:
 *  - `ChannelGoneError` (Discord 10003) is EXPECTED — unbind + suppress, and
 *    never `Sentry.capture*` it.
 *  - `LifecyclePermissionError` (50013 / 50001) is guild-wide — stop the tick
 *    and send ONE Sentry message.
 * Anything else is left as thrown. Also home of the error-translating call
 * wrapper and channel lookup the ops in `channel-lifecycle.discord-ops.ts` use.
 */
import {
  ChannelType,
  DiscordAPIError,
  type Guild,
  type GuildBasedChannel,
  type NewsChannel,
  type TextChannel,
} from 'discord.js';
import { timedDiscordCall } from '../services/scheduled-event.helpers';

/** A managed lifecycle channel: plain text or announcement. */
export type LifecycleTextChannel = TextChannel | NewsChannel;

/** Discord "Unknown Channel". */
export const UNKNOWN_CHANNEL = 10003;
/** Discord "Missing Access" — the bot cannot see the channel/category. */
export const MISSING_ACCESS = 50001;
/** Discord "Missing Permissions" — e.g. no Manage Channels / Manage Roles. */
export const MISSING_PERMISSIONS = 50013;

/** Discord "Maximum number of guild channels reached (500)". */
export const MAX_GUILD_CHANNELS = 30013;

/** The guild cannot hold another channel (30013): stop creating this tick (§2.13). */
export class CreateCapacityError extends Error {
  override readonly name = 'CreateCapacityError';

  /** @param op - The lifecycle op label that failed (e.g. `create`). */
  constructor(
    readonly op: string,
    options?: { cause: unknown },
  ) {
    super(`Discord refused ${op}: the server is at its channel limit`, options);
  }
}

/** The managed channel no longer exists in Discord (hand-deleted). */
export class ChannelGoneError extends Error {
  override readonly name = 'ChannelGoneError';

  /** @param channelId - Discord id of the channel that is gone. */
  constructor(
    readonly channelId: string,
    options?: { cause: unknown },
  ) {
    super(`Discord channel ${channelId} no longer exists`, options);
  }
}

/** The bot lacks the permission/access an op needs; stop the whole tick. */
export class LifecyclePermissionError extends Error {
  override readonly name = 'LifecyclePermissionError';

  /**
   * @param op - The lifecycle op label that failed (e.g. `archive.move`).
   * @param code - The Discord error code (50013 or 50001).
   */
  constructor(
    readonly op: string,
    readonly code: number,
    options?: { cause: unknown },
  ) {
    super(`Discord refused ${op} (code ${code})`, options);
  }
}

/** True when `err` is a `DiscordAPIError` carrying `code`. */
export function isDiscordCode(err: unknown, code: number): boolean {
  return err instanceof DiscordAPIError && err.code === code;
}

/**
 * Translate a discord.js failure into the lifecycle's typed errors. 10003 maps
 * to `ChannelGoneError` only when the op targets a known `channelId`; anything
 * that is not a recognised code is returned unchanged so it propagates as-is.
 */
export function mapLifecycleError(
  err: unknown,
  op: string,
  channelId: string | null,
): unknown {
  if (channelId !== null && isDiscordCode(err, UNKNOWN_CHANNEL)) {
    return new ChannelGoneError(channelId, { cause: err });
  }
  if (isDiscordCode(err, MAX_GUILD_CHANNELS)) {
    return new CreateCapacityError(op, { cause: err });
  }
  for (const code of [MISSING_PERMISSIONS, MISSING_ACCESS]) {
    if (isDiscordCode(err, code)) {
      return new LifecyclePermissionError(op, code, { cause: err });
    }
  }
  return err;
}

/** Run one Discord call as `lifecycle.<op>` and translate its failure. */
export async function lifecycleCall<T>(
  op: string,
  channelId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await timedDiscordCall(`lifecycle.${op}`, fn);
  } catch (err) {
    throw mapLifecycleError(err, op, channelId);
  }
}

function isLifecycleText(
  ch: GuildBasedChannel | null | undefined,
): ch is LifecycleTextChannel {
  return (
    ch?.type === ChannelType.GuildText ||
    ch?.type === ChannelType.GuildAnnouncement
  );
}

/** Cache-then-fetch a managed text channel; gone/non-text → ChannelGoneError. */
export async function resolveTextChannel(
  guild: Guild,
  channelId: string,
): Promise<LifecycleTextChannel> {
  const channel =
    guild.channels.cache.get(channelId) ??
    (await lifecycleCall('fetch', channelId, () =>
      guild.channels.fetch(channelId),
    ));
  if (!isLifecycleText(channel)) throw new ChannelGoneError(channelId);
  return channel;
}
