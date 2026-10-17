/**
 * ROK-1483 — the pure half of the thread mirror: gateway message in, row out,
 * row in, DTO out. No drizzle handle, no Discord client, no clock.
 *
 * The discord.js inputs are typed STRUCTURALLY (the `Mirror*` interfaces
 * below) rather than against `Message`. A `Message` cannot be constructed
 * without a client, so typing against it would force every unit test through a
 * gateway fixture; a structural type is satisfied by both the real object and
 * a two-line literal. discord.js `Collection` extends `Map`, so its collections
 * assign straight into the `ReadonlyMap` fields.
 */
import type {
  ThreadMessageDto,
  ThreadMessageMentionDto,
  ThreadMessageAttachmentDto,
} from '@raid-ledger/contract';
import type {
  discordThreadMessages,
  MirroredReaction,
} from '../../drizzle/schema/discord-thread-messages';

/** A mirrored row as Postgres returns it. */
export type MirroredMessageRow = typeof discordThreadMessages.$inferSelect;

/**
 * The columns {@link toMirrorRow} can derive from a message alone.
 *
 * `threadId` is deliberately absent: it belongs to the binding, not to the
 * message, and the db helper takes it as its own argument.
 */
export type MirroredMessageValues = Omit<
  typeof discordThreadMessages.$inferInsert,
  'threadId' | 'id' | 'mirrorUpdatedAt' | 'deletedAt'
>;

/** The author fields the mirror reads. */
export interface MirrorMessageAuthor {
  id: string;
  username: string;
  displayName?: string | null;
  avatar: string | null;
  bot?: boolean;
}

/** The mention collections the mirror resolves at write time (D8). */
export interface MirrorMessageMentions {
  users: ReadonlyMap<
    string,
    { id: string; username: string; displayName?: string | null }
  >;
  roles: ReadonlyMap<string, { id: string; name: string }>;
  channels: ReadonlyMap<string, { id: string; name?: string | null }>;
}

/**
 * The slice of a discord.js `MessageReaction` the reducer reads (ROK-1506).
 *
 * `count` and `name` are nullable because they ARE on the real object: a
 * partial reaction carries `count: null`, and a deleted custom emoji carries
 * `name: null`. The reactor `users` manager is deliberately not part of this
 * shape — the snapshot must never be able to see who reacted (AC4).
 */
export interface MirrorSourceReaction {
  emoji: { id: string | null; name: string | null; animated: boolean | null };
  count: number | null;
}

/** `Message#reactions` is a manager, not a Map — the cache sits one level in. */
export interface MirrorSourceReactions {
  cache: ReadonlyMap<string, MirrorSourceReaction>;
}

/** The structural shape of a discord.js `Message` this module needs. */
export interface MirrorSourceMessage {
  id: string;
  content: string;
  createdAt: Date;
  editedAt: Date | null;
  author: MirrorMessageAuthor;
  attachments: ReadonlyMap<string, { name: string; url: string }>;
  mentions: MirrorMessageMentions;
  /**
   * OPTIONAL (ROK-1506 D5): a real `Message` always has it; the DEMO seam and
   * unit fixtures build literals without it and must keep compiling.
   */
  reactions?: MirrorSourceReactions;
}

/**
 * A Discord snowflake as the exact bigint the `sort_key` column stores (D5).
 *
 * Snowflakes are decimal STRINGS and are not lexicographically ordered, and
 * they exceed `Number.MAX_SAFE_INTEGER`, so neither a varchar comparison nor a
 * float round-trip orders them correctly. They are below 2^63, so a signed
 * bigint is exact and monotonic in time.
 *
 * @param id - The Discord message id.
 * @returns The snowflake as a bigint.
 */
export function snowflakeToSortKey(id: string): bigint {
  return BigInt(id);
}

/** The author's name as it read at post time, never re-resolved later. */
function displayNameOf(author: MirrorMessageAuthor): string {
  return author.displayName ?? author.username;
}

/** Every mention on the message, flattened and resolved (D8). */
function toMentions(
  mentions: MirrorMessageMentions,
): ThreadMessageMentionDto[] {
  return [
    ...[...mentions.users.values()].map((user) => ({
      id: user.id,
      kind: 'user' as const,
      displayName: user.displayName ?? user.username,
    })),
    ...[...mentions.roles.values()].map((role) => ({
      id: role.id,
      kind: 'role' as const,
      displayName: role.name,
    })),
    ...[...mentions.channels.values()].map((channel) => ({
      id: channel.id,
      kind: 'channel' as const,
      displayName: channel.name ?? 'unknown',
    })),
  ];
}

/**
 * The whole-set reaction snapshot of one message (ROK-1506 D3 / D7).
 *
 * Never an increment: every reaction event recomputes the entire array from
 * the cache, so two events racing converge and a missed event is repaired by
 * the next one. Entries with a null or non-positive count are dropped —
 * discord.js decrements on `messageReactionRemove` and can leave a zero-count
 * entry in the cache, which would otherwise render as a `🔥 0` pill. Order is
 * the cache's own (Discord's first-reacted-first) and is preserved verbatim.
 *
 * @param cache - `message.reactions.cache`, or undefined when absent.
 * @returns Counts only — exactly `{key, name, id, animated, count}`.
 */
export function toReactionSnapshot(
  cache: ReadonlyMap<string, MirrorSourceReaction> | undefined,
): MirroredReaction[] {
  if (!cache) return [];
  const snapshot: MirroredReaction[] = [];
  for (const reaction of cache.values()) {
    const { id, name, animated } = reaction.emoji;
    const key = id ?? name;
    if (key === null || reaction.count == null || reaction.count <= 0) continue;
    snapshot.push({
      key,
      // A deleted custom emoji has an id but no name; 'emoji' keeps the alt
      // text non-empty rather than crashing the row.
      name: name ?? 'emoji',
      id,
      animated: animated === true,
      count: reaction.count,
    });
  }
  return snapshot;
}

/**
 * A gateway message as the columns of one mirror row.
 *
 * `content` is stored VERBATIM — raw `<@123>` markers and all. Substitution
 * happens in the viewer off the `mentions` array, so the server never bakes in
 * a render policy it would have to change later.
 *
 * @param message - The message, structurally typed.
 * @param guildId - Kept on the row so the Open-in-Discord url needs no client.
 * @returns Insert values, minus the columns the binding owns.
 */
export function toMirrorRow(
  message: MirrorSourceMessage,
  guildId: string,
): MirroredMessageValues {
  const attachments: ThreadMessageAttachmentDto[] = [
    ...message.attachments.values(),
  ].map((attachment) => ({ name: attachment.name, url: attachment.url }));

  return {
    guildId,
    messageId: message.id,
    sortKey: snowflakeToSortKey(message.id),
    authorDiscordId: message.author.id,
    authorDisplayName: displayNameOf(message.author),
    authorAvatarHash: message.author.avatar,
    content: message.content,
    attachments,
    mentions: toMentions(message.mentions),
    reactions: toReactionSnapshot(message.reactions?.cache),
    discordCreatedAt: message.createdAt,
    editedAt: message.editedAt,
  };
}

/** Exactly the columns the wire DTO is built from. */
export type ThreadMessageDtoRow = Pick<
  MirroredMessageRow,
  | 'messageId'
  | 'authorDiscordId'
  | 'authorDisplayName'
  | 'authorAvatarHash'
  | 'content'
  | 'attachments'
  | 'mentions'
  | 'reactions'
  | 'discordCreatedAt'
  | 'editedAt'
>;

/**
 * A mirrored row as the wire DTO.
 *
 * The avatar HASH is what is stored; the DTO ships the resolved CDN url so the
 * web app never learns Discord's url format (A9). A null hash stays null and
 * the viewer falls back to initials.
 *
 * @param row - The mirrored row.
 * @returns The DTO. A soft-deleted row is filtered out upstream, never here.
 */
export function toThreadMessageDto(row: ThreadMessageDtoRow): ThreadMessageDto {
  return {
    messageId: row.messageId,
    author: {
      discordUserId: row.authorDiscordId,
      displayName: row.authorDisplayName,
      avatarUrl:
        row.authorAvatarHash === null
          ? null
          : `https://cdn.discordapp.com/avatars/${row.authorDiscordId}/${row.authorAvatarHash}.png?size=64`,
    },
    content: row.content,
    attachments: row.attachments,
    mentions: row.mentions,
    reactions: row.reactions,
    createdAt: row.discordCreatedAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

/**
 * The Discord deep link for a thread.
 *
 * @param guildId - Guild the thread lives in.
 * @param threadId - The thread (forum post) id.
 * @returns The canonical `discord.com/channels` url.
 */
export function buildThreadUrl(guildId: string, threadId: string): string {
  return `https://discord.com/channels/${guildId}/${threadId}`;
}

/**
 * Whether a message was posted by THIS app's bot (D9, as corrected by A1b).
 *
 * Keyed on the app's own user id rather than on `author.bot`, because the
 * companion bot that drives the AC7 smoke test IS a bot: skipping every bot
 * would make the mirror untestable end-to-end. What this guard exists to stop
 * is the board's own starter post and its edit-on-every-roster-change noise —
 * that is the app's own id, not all bots.
 *
 * @param message - The message, structurally typed.
 * @param clientUserId - `client.user?.id`, or null before the bot is ready.
 * @returns True only when the app itself authored the message.
 */
export function isOwnBotMessage(
  message: Pick<MirrorSourceMessage, 'author'>,
  clientUserId: string | null | undefined,
): boolean {
  return clientUserId != null && message.author.id === clientUserId;
}
