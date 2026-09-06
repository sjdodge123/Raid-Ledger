/**
 * ROK-1493 D1/D2 + ROK-1492 D4 — the pure half of "the board owns its forum".
 *
 * No Logger, no Discord I/O: every branch is unit-testable against literals.
 *
 *  1. **The overwrite is a PAIR.** `@everyone` is denied `SendMessages` (which
 *     is what Discord maps a forum's "Create Posts" to — `CreatePublicThreads`
 *     is the *text*-channel flag, kept here as documented intent), and the app
 *     bot's own user carries an explicit allow. Without that allow a non-admin
 *     bot locks itself out of the board it just locked (A1, ruled 2026-09-06).
 *  2. **`SendMessagesInThreads` is touched by neither half** — replies inside a
 *     post stay open, because that is the group's conversation (R2).
 *  3. **The topic carries a sentinel**, which is how a restored install finds
 *     the forum again (ROK-1492 AC1). A4 was ruled 2026-09-06: the topic is
 *     asserted to *contain* the sentinel — operator text is never overwritten.
 */
import { OverwriteType } from 'discord.js';
import type {
  OverwriteData,
  PermissionsBitField,
  PermissionsString,
} from 'discord.js';

/** What `@everyone` loses on the board forum (D1). */
export const LFG_BOARD_DENY_FLAGS = [
  'SendMessages',
  'CreatePublicThreads',
  'CreatePrivateThreads',
] as const satisfies readonly PermissionsString[];

/** What the app bot keeps, so the deny above can never lock it out (A1). */
export const LFG_BOARD_BOT_ALLOW_FLAGS = [
  'SendMessages',
  'CreatePublicThreads',
] as const satisfies readonly PermissionsString[];

/** The ownership mark ROK-1492 rediscovers the forum by. Never re-typed. */
export const LFG_BOARD_TOPIC_SENTINEL = '· raid-ledger:lfg-board';

/** Post guidelines, written only into a forum whose topic is empty (A4). */
export const LFG_BOARD_TOPIC_GUIDELINES = [
  'Posts here are made by Raid Ledger — one post per group of players looking for more people for a single game.',
  '',
  'You cannot start a post here. Raise a hand with /lfg, or on the Raid Ledger site, and a post appears once a second person raises a hand for the same game.',
  '',
  "Replies inside a post are open — that is the group's conversation. Say hello there.",
].join('\n');

/** The full topic a bot-created forum is born with: guidelines + sentinel. */
export const LFG_BOARD_TOPIC = `${LFG_BOARD_TOPIC_GUIDELINES}\n\n${LFG_BOARD_TOPIC_SENTINEL}`;

/** One resolved overwrite as discord.js caches it — the only shape D2 reads. */
interface ResolvedOverwrite {
  allow: Readonly<PermissionsBitField>;
  deny: Readonly<PermissionsBitField>;
}

/** A `ForumChannel` narrowed to what {@link overwritesUpToDate} touches. */
export interface BoardOverwriteHolder {
  permissionOverwrites: { cache: ReadonlyMap<string, ResolvedOverwrite> };
}

/** Which halves of the board overwrite are already in place (D2). */
export interface BoardOverwriteState {
  /** The `@everyone` deny already covers every flag in `LFG_BOARD_DENY_FLAGS`. */
  everyone: boolean;
  /** The bot's own allow already covers every flag it needs to post. */
  bot: boolean;
}

/**
 * The overwrite pair passed to `guild.channels.create`.
 *
 * @param everyoneRoleId - `guild.roles.everyone.id`.
 * @param botUserId - The app bot's own user id, or null when the member cache
 *   has not populated — in which case the bot half is omitted rather than
 *   emitted with an undefined id (P4).
 * @returns One or two `OverwriteData` entries, `@everyone` first.
 */
export function boardOverwrites(
  everyoneRoleId: string,
  botUserId: string | null,
): OverwriteData[] {
  const overwrites: OverwriteData[] = [
    {
      id: everyoneRoleId,
      type: OverwriteType.Role,
      deny: [...LFG_BOARD_DENY_FLAGS],
    },
  ];
  if (botUserId) {
    overwrites.push({
      id: botUserId,
      type: OverwriteType.Member,
      allow: [...LFG_BOARD_BOT_ALLOW_FLAGS],
    });
  }
  return overwrites;
}

/**
 * Whether each half of the board overwrite is already satisfied (D2).
 *
 * Compares the *resolved bitfields*, so a stricter operator deny (a superset)
 * counts as satisfied and re-flipping the toggle churns no audit-log entry.
 *
 * @param forum - The forum, read from its cached overwrites — no API call.
 * @param everyoneRoleId - `guild.roles.everyone.id`.
 * @param botUserId - The app bot's user id; null reports `bot: true`, since
 *   there is no id to write an overwrite for.
 * @returns `{ everyone, bot }`, each true when nothing needs editing.
 */
export function overwritesUpToDate(
  forum: BoardOverwriteHolder,
  everyoneRoleId: string,
  botUserId: string | null,
): BoardOverwriteState {
  const cache = forum.permissionOverwrites.cache;
  const everyoneOw = cache.get(everyoneRoleId);
  const botOw = botUserId ? cache.get(botUserId) : undefined;
  return {
    everyone:
      everyoneOw !== undefined &&
      LFG_BOARD_DENY_FLAGS.every((flag) => everyoneOw.deny.has(flag)),
    bot:
      !botUserId ||
      (botOw !== undefined &&
        LFG_BOARD_BOT_ALLOW_FLAGS.every((flag) => botOw.allow.has(flag))),
  };
}

/**
 * Whether a forum topic carries the board's ownership sentinel (ROK-1492 AC1).
 *
 * @param topic - `ForumChannel.topic`, which may be null on an untouched forum.
 * @returns True when the sentinel line appears anywhere in the topic.
 */
export function topicHasSentinel(topic: string | null | undefined): boolean {
  return (topic ?? '').includes(LFG_BOARD_TOPIC_SENTINEL);
}

/**
 * The topic to write so the forum is marked, without losing operator text (A4).
 *
 * @param topic - The forum's current topic.
 * @returns `topic` unchanged when it already carries the sentinel; the full
 *   guidelines when the topic is empty; otherwise the operator's own text with
 *   the sentinel appended on its own line.
 */
export function topicWithSentinel(topic: string | null | undefined): string {
  const current = topic ?? '';
  if (topicHasSentinel(current)) return current;
  if (current.trim() === '') return LFG_BOARD_TOPIC;
  return `${current.trimEnd()}\n\n${LFG_BOARD_TOPIC_SENTINEL}`;
}
