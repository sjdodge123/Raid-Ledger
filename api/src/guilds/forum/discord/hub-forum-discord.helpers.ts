import { HttpException } from '@nestjs/common';
import { PermissionFlagsBits } from 'discord.js';
import {
  HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME,
  HUB_FORUM_DISCORD_TAG_LIMIT,
  PutHubForumDiscordSchema,
  type PutHubForumDiscordInput,
} from '@raid-ledger/contract';

/**
 * ROK-2208 §5.1 step 4 — what the bot needs IN the forum channel to sync it.
 * Labels match `REQUIRED_PERMISSIONS` naming so the UI can list them.
 */
export const FORUM_SYNC_PERMISSIONS: readonly {
  label: string;
  flag: bigint;
}[] = [
  { label: 'View Channels', flag: PermissionFlagsBits.ViewChannel },
  { label: 'Send Messages', flag: PermissionFlagsBits.SendMessages },
  {
    label: 'Send Messages in Threads',
    flag: PermissionFlagsBits.SendMessagesInThreads,
  },
  {
    label: 'Create Public Threads',
    flag: PermissionFlagsBits.CreatePublicThreads,
  },
  { label: 'Manage Threads', flag: PermissionFlagsBits.ManageThreads },
  { label: 'Manage Messages', flag: PermissionFlagsBits.ManageMessages },
  { label: 'Manage Webhooks', flag: PermissionFlagsBits.ManageWebhooks },
  {
    label: 'Read Message History',
    flag: PermissionFlagsBits.ReadMessageHistory,
  },
];

/** Creating the forum and editing its tags/flags rides on Manage Channels. */
export const MANAGE_CHANNELS = {
  label: 'Manage Channels',
  flag: PermissionFlagsBits.ManageChannels,
};

/** Discord's forum tag name cap (`GuildForumTag.name`, 0–20 chars). */
export const FORUM_TAG_NAME_MAX = 20;

/** Webhook display name (R9: one per forum; per-message name/avatar). */
export const FORUM_WEBHOOK_NAME = 'Raid Ledger';

/**
 * Labels of the sync permissions `has` lacks, in declaration order.
 *
 * @param has - Whether the bot holds a flag (channel-scoped when it can be).
 * @param manageChannels - Also require Manage Channels (create, tag edits).
 */
export function missingForumPermissions(
  has: (flag: bigint) => boolean,
  manageChannels: boolean,
): string[] {
  const needed = manageChannels
    ? [MANAGE_CHANNELS, ...FORUM_SYNC_PERMISSIONS]
    : FORUM_SYNC_PERMISSIONS;
  return needed.filter((p) => !has(p.flag)).map((p) => p.label);
}

/** A hub's forum tag name: its name, trimmed to Discord's cap. */
export function tagNameFor(hubName: string): string {
  return hubName.trim().slice(0, FORUM_TAG_NAME_MAX).trim() || 'Hub';
}

/** Discord's channel name cap. */
const CHANNEL_NAME_MAX = 100;

/**
 * Q10(c) — the name of a hub's OWN new forum: lower-case, words joined by
 * `-` (how Discord shows it). The shared `#hub-forums` name is refused so a
 * second forum by that name is never made (400 `FORUM_DISCORD_NAME_RESERVED`).
 */
export function forumChannelName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .slice(0, CHANNEL_NAME_MAX)
    .replace(/^-+|-+$/g, '');
  const name = slug || 'hub-forum';
  if (name === HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME) {
    throw forumDiscordError(
      400,
      'FORUM_DISCORD_NAME_RESERVED',
      `#${HUB_FORUM_DISCORD_DEFAULT_CHANNEL_NAME} is the shared forum. Pick another name for this hub's own forum.`,
    );
  }
  return name;
}

/** MAJOR-4: a forum @everyone cannot see is never bound or offered. */
export function channelPrivate(): HttpException {
  return forumDiscordError(
    409,
    'FORUM_DISCORD_CHANNEL_PRIVATE',
    'This forum is private in Discord. Raid Ledger only syncs forums everyone in the server can see.',
  );
}

/** Free tag slots on a forum (0 = the shared option is unavailable). */
export function tagsFree(tagCount: number): number {
  return Math.max(0, HUB_FORUM_DISCORD_TAG_LIMIT - tagCount);
}

/** One hub on a shared forum and the tag name it should carry. */
export interface HubTagNeed {
  guildId: number;
  name: string;
}

/**
 * §5.1 step 6 — the tags a shared forum must gain. A hub that already has a
 * tag keeps it; a tag whose name already exists is reused (an unbound hub's
 * tag stays on old posts). Throws `FORUM_DISCORD_TAG_LIMIT` past 20 tags,
 * counting a moderator's own tags too.
 *
 * @param existing - Tags already on the forum.
 * @param hubs - Every hub that will share the forum, the binding one included.
 * @returns The names to create and the hubs needing a tag assigned.
 */
export function planSharedTags(
  existing: readonly { id: string; name: string }[],
  hubs: readonly { guildId: number; tagId: string | null; hubName: string }[],
): { create: string[]; assign: HubTagNeed[] } {
  const owned = new Set(hubs.map((h) => h.tagId));
  const taken = new Set(
    existing.filter((t) => owned.has(t.id)).map((t) => t.name),
  );
  const assign = hubs
    .filter((h) => h.tagId === null)
    .map((h) => ({
      guildId: h.guildId,
      name: claimName(tagNameFor(h.hubName), taken),
    }));
  const present = new Set(existing.map((t) => t.name));
  const create = assign.map((a) => a.name).filter((n) => !present.has(n));
  if (existing.length + create.length > HUB_FORUM_DISCORD_TAG_LIMIT) {
    throw forumDiscordError(
      409,
      'FORUM_DISCORD_TAG_LIMIT',
      `This Discord forum already carries the maximum of ${String(HUB_FORUM_DISCORD_TAG_LIMIT)} tags. Pick or create another forum.`,
    );
  }
  return { create, assign };
}

/** `base`, or `base 2`, `base 3`… when another bound hub holds the name. */
function claimName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n += 1) {
    const suffix = ` ${String(n)}`;
    name = base.slice(0, FORUM_TAG_NAME_MAX - suffix.length).trimEnd() + suffix;
  }
  taken.add(name);
  return name;
}

/**
 * The PUT body: a missing/false `ack` is `FORUM_DISCORD_ACK_REQUIRED` (R1)
 * before any other validation, so no channel is ever made without it.
 */
export function parseBindBody(body: unknown): PutHubForumDiscordInput {
  const acked =
    typeof body === 'object' &&
    body !== null &&
    'ack' in body &&
    body.ack === true;
  if (!acked) {
    throw forumDiscordError(
      400,
      'FORUM_DISCORD_ACK_REQUIRED',
      'Confirm that everyone who can see the Discord channel can read and post in your hub forum.',
    );
  }
  const parsed = PutHubForumDiscordSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid request';
    throw forumDiscordError(400, 'FORUM_DISCORD_INVALID', msg);
  }
  return parsed.data;
}

/** A coded error the settings UI can branch on (§12). */
export function forumDiscordError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException(
    { statusCode: status, code, message, ...extra },
    status,
  );
}
