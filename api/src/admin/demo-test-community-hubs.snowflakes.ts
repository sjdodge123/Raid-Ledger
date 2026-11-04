/**
 * The community-hubs seed's synthetic Discord snowflakes (split out of
 * demo-test-community-hubs.helpers.ts, import-light so the daily guild sweep
 * can recognise seed users without pulling in the seed's db helpers).
 */
import { createHash } from 'node:crypto';
import { isTaggedCrewUsername } from './demo-test-community-hubs.crew';

/** Every user the seed creates or reuses; the index derives its snowflake. */
export const SEED_USERNAMES: readonly string[] = [
  'community-leader',
  'community-officer',
  'community-member-1',
  'community-member-2',
  'community-member-3',
  'community-member-4',
  'community-banned',
  'community-solo',
  'demo-member',
];

/** Offset that keeps the synthetic ids clear of the integration specs' `91…`. */
const SEED_SNOWFLAKE_BASE = 1870_000;

/**
 * A unique synthetic Discord snowflake (`9` + 17 digits) for a seed user, so
 * the A2 gate (`isInDiscordGuild`) admits them — a `local:` placeholder does
 * not (OQ-6). Throws for a username outside `SEED_USERNAMES`.
 */
export function seedDiscordId(username: string): string {
  const index = SEED_USERNAMES.indexOf(username);
  if (index >= 0) {
    return `9${String(SEED_SNOWFLAKE_BASE + index).padStart(17, '0')}`;
  }
  if (isTaggedCrewUsername(username)) return taggedCrewDiscordId(username);
  throw new Error(`${username} is not a seed user`);
}

/**
 * ROK-2030: a tag's crew user's snowflake — `98` + 16 digits hashed from the
 * username (52 bits of sha256), deterministic so parallel first-run seeds of
 * one tag collide on it like the shared users do, and clear of the shared
 * users' `90…` and the integration specs' `91…`.
 */
function taggedCrewDiscordId(username: string): string {
  const hex = createHash('sha256').update(username).digest('hex');
  return `98${String(parseInt(hex.slice(0, 13), 16)).padStart(16, '0')}`;
}

/**
 * True for a hub-seed user still on its own synthetic snowflake: the seed
 * stamps `guild_member_seen_at` (the A2 gate needs it) but the id is in no real
 * guild, so the daily guild sweep must not deactivate it as a leaver
 * (TECH-DEBT 2026-10-23: the 07:00Z sweep deactivated every seeded hub user on
 * a fleet env mid-run). A seed user re-linked to a real Discord id is NOT
 * matched, so it is swept like anyone else.
 */
export function isSeedSyntheticUser(user: {
  username: string;
  discordId: string | null;
}): boolean {
  if (user.discordId === null) return false;
  try {
    return seedDiscordId(user.username) === user.discordId;
  } catch {
    return false;
  }
}
