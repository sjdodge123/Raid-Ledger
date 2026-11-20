import {
  EVENT_PLANNING_TAGS,
  HUB_FORUM_DISCORD_TAG_LIMIT,
} from '@raid-ledger/contract';
import { DiscordAPIError } from 'discord.js';

/** ROK-2258 ruling 2 — the tag every synced event post carries. */
export const EVENT_TAG_NAME = EVENT_PLANNING_TAGS.event;

/** ROK-2272 §3.3 — the tag a scheduling-poll post carries (made on demand). */
export const POLL_TAG_NAME = EVENT_PLANNING_TAGS.poll;

/** ROK-2272 §3.3 — the tag a lineup post carries (made on demand). */
export const LINEUP_TAG_NAME = EVENT_PLANNING_TAGS.lineup;

/** Kind tags a hub tag may never share (inbound routing, §3.3). */
export const RESERVED_TAG_NAMES: readonly string[] = [
  EVENT_TAG_NAME,
  POLL_TAG_NAME,
  LINEUP_TAG_NAME,
];

/** True when `name` (any case, trimmed) is a reserved kind tag. */
export function isReservedTagName(name: string): boolean {
  const want = name.trim().toLowerCase();
  return RESERVED_TAG_NAMES.some((r) => r.toLowerCase() === want);
}

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
 * ROK-2272 §3.3 — the id of kind tag `name` (Event/Poll/Lineup), skipping
 * any tag a hub binding owns. A hub named "Poll" before the reservation
 * keeps its "Poll" tag (no retroactive rename); a kind post then goes
 * untagged rather than wearing that hub's tag. `planTagCreates` still sees
 * the name as taken, so no duplicate-named tag is attempted.
 *
 * @param existing - The forum's tags.
 * @param name - The kind tag name.
 * @param hubTagIds - Tag ids bound to hubs on this forum (`bindings.tagId`).
 */
export function findKindTagId(
  existing: readonly ForumTag[],
  name: string,
  hubTagIds: readonly (string | null)[],
): string | null {
  const owned = new Set(hubTagIds);
  return findTagId(
    existing.filter((t) => !owned.has(t.id)),
    name,
  );
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
 * Codex P2 #1 — the forum's Event tag, unless a hub owns a tag by that name
 * (a pre-ROK-2258 hub called "Event"): sharing one tag would match two hubs
 * on inbound routing, so event tagging is skipped instead.
 *
 * @param tags - The forum's tags.
 * @param hubTagIds - The bound hubs' tag ids.
 */
export function eventTagIdOf(
  tags: readonly ForumTag[],
  hubTagIds: readonly (string | null)[],
): string | null {
  const id = findTagId(tags, EVENT_TAG_NAME);
  return id !== null && hubTagIds.includes(id) ? null : id;
}

/** Discord allows at most 5 tags on one forum post. */
const POST_TAG_MAX = 5;

/**
 * ROK-2258 ruling 2 — the tags a new forum post carries: the hub's tag(s),
 * plus the forum's Event tag on an event post (when the forum has one),
 * de-duplicated and capped at Discord's 5 per post.
 */
export function postTagIds(
  base: readonly string[],
  isEvent: boolean,
  forumTags: readonly ForumTag[],
): string[] {
  const eventTagId = isEvent ? findTagId(forumTags, EVENT_TAG_NAME) : null;
  const all = eventTagId === null ? base : [...base, eventTagId];
  return [...new Set(all)].slice(0, POST_TAG_MAX);
}

/**
 * How a dressing run ended (review r1 MAJOR 1): `done`, `settled` (skipped
 * for good — no retry fixes it) or `retry` (transient: worth another go).
 */
export type DecorOutcome = 'done' | 'settled' | 'retry';

/** Unknown Channel, Missing Access, Missing Permissions: no retry fixes them. */
const PERMANENT_DISCORD_CODES: ReadonlySet<number> = new Set([
  10003, 50001, 50013,
]);

/**
 * Classify a thrown dressing error: a permanent Discord refusal settles,
 * everything else (429, 5xx, network, DB) is worth a retry.
 */
export function failureOutcome(err: unknown): DecorOutcome {
  const permanent =
    err instanceof DiscordAPIError &&
    typeof err.code === 'number' &&
    PERMANENT_DISCORD_CODES.has(err.code);
  return permanent ? 'settled' : 'retry';
}
