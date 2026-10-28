/**
 * ROK-2030 — tag-scoped community-hubs seeding. Smoke specs on several
 * Playwright projects/workers share ~8 CI games, so two specs often seed the
 * same game at once. A `tag` makes each spec's fixture its own: every seeded
 * hub is named `<base> #<tag>` (unique per game under
 * `idx_guilds_community_name`) and the reset clears only that tag's hubs.
 * Untagged seeds keep the plain names and today's sweep, minus tagged hubs.
 */
import {
  SEED_HUB_NAMES,
  type CommunityHubsSeedResult,
} from './demo-test-community-hubs.helpers';
import { SEED_OTHER_KIND_NAMES } from './demo-test-community-hubs.other-kinds';

/** Every name the seed gives a hub, by role. */
export type SeedHubNames = CommunityHubsSeedResult['hubNames'];

/** `base` untagged, else `base #tag`. */
export function taggedHubName(base: string, tag: string | undefined): string {
  return tag === undefined ? base : `${base} #${tag}`;
}

/** The seed's hub names for `tag` (the plain names when untagged). */
export function seedHubNames(tag: string | undefined): SeedHubNames {
  const base = { ...SEED_HUB_NAMES, ...SEED_OTHER_KIND_NAMES };
  return {
    crew: taggedHubName(base.crew, tag),
    solo: taggedHubName(base.solo, tag),
    proposed: taggedHubName(base.proposed, tag),
    archived: taggedHubName(base.archived, tag),
    server: taggedHubName(base.server, tag),
    guild: taggedHubName(base.guild, tag),
  };
}

/** LIKE pattern for any tagged seed hub's name (`… #tag`). */
export const TAGGED_NAME_LIKE = '% #%';

/**
 * LIKE pattern for the blurb of `tag`'s hubs (`<base> #<tag> — …`), which
 * survives a rename (hub-rename.smoke renames the crew hub).
 */
export function taggedBlurbLike(tag: string): string {
  return `% #${tag} — %`;
}

/** LIKE pattern for any tagged seed hub's blurb. */
export const TAGGED_BLURB_LIKE = '% #% — %';
