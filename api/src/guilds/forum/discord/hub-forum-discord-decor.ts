import { HUB_FORUM_DISCORD_TAG_LIMIT } from '@raid-ledger/contract';

/** ROK-2258 ruling 2 — the tag every synced event post carries. */
export const EVENT_TAG_NAME = 'Event';

/** ROK-2258 ruling 1 — the forum's default reaction when none is set. */
export const DEFAULT_REACTION_EMOJI = '👍';

/** A forum tag as the binding sees it. */
export interface ForumTag {
  id: string;
  name: string;
}

/** A forum's default reaction (discord.js `DefaultReactionEmoji`), or null. */
export interface DefaultReaction {
  id: string | null;
  name: string | null;
}

const key = (name: string): string => name.trim().toLowerCase();

/**
 * The id of the forum tag called `name` (case-insensitive), or null.
 *
 * @param existing - The forum's tags.
 * @param name - The tag name to look for.
 */
export function findTagId(
  existing: readonly ForumTag[],
  name: string,
): string | null {
  const want = key(name);
  return existing.find((t) => key(t.name) === want)?.id ?? null;
}

/**
 * ROK-2258 ruling 2 — which wanted tags to create: a name already on the
 * forum (any case) is reused; what does not fit under Discord's 20-tag cap
 * is skipped (the caller logs it) rather than failing the bind.
 *
 * @param existing - Tags already on the forum, moderators' own included.
 * @param wanted - Tag names the forum should carry, in priority order.
 */
export function planTagCreates(
  existing: readonly ForumTag[],
  wanted: readonly string[],
): { create: string[]; skipped: string[] } {
  const seen = new Set(existing.map((t) => key(t.name)));
  const create: string[] = [];
  const skipped: string[] = [];
  for (const name of wanted) {
    if (seen.has(key(name))) continue;
    seen.add(key(name));
    const fits = existing.length + create.length < HUB_FORUM_DISCORD_TAG_LIMIT;
    (fits ? create : skipped).push(name);
  }
  return { create, skipped };
}

/**
 * ROK-2258 ruling 1 — set 👍 only while the forum has no default reaction;
 * a moderator's choice (unicode or custom emoji) is never overwritten.
 */
export function shouldSetDefaultReaction(
  current: DefaultReaction | null,
): boolean {
  return current === null || (current.id === null && current.name === null);
}

/**
 * ROK-2258 ruling 3 — Require tags only once more than one hub shares the
 * forum, and only when it is not already on.
 *
 * @param boundHubs - Hubs bound to the forum, the binding one included.
 * @param alreadyRequired - Discord's Require tags flag is on.
 */
export function shouldRequireTags(
  boundHubs: number,
  alreadyRequired: boolean,
): boolean {
  return boundHubs > 1 && !alreadyRequired;
}

/**
 * The tags a new forum post carries: the hub's tag, plus the forum's Event
 * tag on an event post (when the forum has one).
 */
export function postTagIds(
  hubTagId: string | null,
  isEvent: boolean,
  forumTags: readonly ForumTag[],
): string[] {
  const eventTagId = isEvent ? findTagId(forumTags, EVENT_TAG_NAME) : null;
  return [hubTagId, eventTagId].filter((id): id is string => id !== null);
}
