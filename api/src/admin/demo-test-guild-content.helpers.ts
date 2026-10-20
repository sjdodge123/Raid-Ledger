/**
 * ROK-1786 L4 — the optional `withContent: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: a `guild_profiles` row (GM post,
 * two multi-line rule sections, one link group), two recommended addons
 * (CurseForge required + GitHub optional) and, ROK-1868, three hub posts
 * (`demo-test-hub-posts.helpers.ts`).
 *
 * Idempotent and restoring: a re-call rewrites the profile, upserts the two
 * addons back to sort 0/1 on their `(guild, source, slug)` key (same ids) and
 * deletes any other addon on the guild — so a smoke or test-plan step that
 * edited the content is reset by re-seeding the same guild name.
 */
import { and, eq, notInArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildAddonRequirement,
  GuildAddonSource,
  GuildLinkGroup,
  GuildRuleSection,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import { seedHubPosts } from './demo-test-hub-posts.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** First line is the Players-card headline (`gmPostHeadline`). */
export const SEED_GUILD_GM_POST =
  'Raid night is Tuesday 8pm server time.\nBring flasks, food and repair gold.';

/** Each body line renders as one list item on the Resources tab. */
export const SEED_GUILD_RULES: GuildRuleSection[] = [
  {
    title: 'Loot',
    body: 'Loot council for tier pieces\nMain spec over off spec\nNo trading raid drops',
  },
  {
    title: 'Attendance',
    body: 'Sign up by Monday night\nTell an officer if you will be late',
  },
];

export const SEED_GUILD_LINKS: GuildLinkGroup[] = [
  {
    title: 'Guides',
    links: [
      {
        label: 'Raid strategy',
        url: 'https://www.wowhead.com/classic/guides/raids',
        note: 'Read before your first raid',
      },
      { label: 'Warcraft Logs', url: 'https://classic.warcraftlogs.com/' },
    ],
  },
];

interface SeedAddon {
  source: GuildAddonSource;
  slugOrUrl: string;
  displayName: string;
  note: string | null;
  requirement: GuildAddonRequirement;
}

/** Slugs are stored lower-case, exactly as `parseAddonLink` would emit them. */
export const SEED_GUILD_ADDONS: readonly SeedAddon[] = [
  {
    source: 'curseforge',
    slugOrUrl: 'details',
    displayName: 'Details! Damage Meter',
    note: 'Everyone runs a meter on raid night.',
    requirement: 'required',
  },
  {
    source: 'github',
    slugOrUrl: 'weakauras/weakauras2',
    displayName: 'WeakAuras',
    note: null,
    requirement: 'optional',
  },
];

export interface SeedGuildContent {
  gmPost: string;
  /** In display order (sort 0, 1). */
  addonIds: number[];
  /** ROK-1868: the seeded hub posts, newest first. */
  postIds: number[];
}

/** Rewrite the guild's profile row to the seeded GM post, rules and links. */
async function upsertProfile(
  db: Db,
  guildId: number,
  gmUserId: number,
  now: Date,
): Promise<void> {
  const set = {
    gmPost: SEED_GUILD_GM_POST,
    gmPostUpdatedAt: now,
    gmPostUpdatedBy: gmUserId,
    rules: SEED_GUILD_RULES,
    links: SEED_GUILD_LINKS,
    updatedAt: now,
  };
  await db
    .insert(schema.guildProfiles)
    .values({ guildId, ...set })
    .onConflictDoUpdate({ target: schema.guildProfiles.guildId, set });
}

async function upsertAddon(
  db: Db,
  guildId: number,
  addon: SeedAddon,
  sortOrder: number,
  gmUserId: number,
): Promise<number> {
  const set = {
    displayName: addon.displayName,
    note: addon.note,
    requirement: addon.requirement,
    flavor: null,
    sortOrder,
    updatedByUserId: gmUserId,
    updatedAt: new Date(),
  };
  const ga = schema.guildRecommendedAddons;
  const [row] = await db
    .insert(ga)
    .values({
      guildId,
      source: addon.source,
      slugOrUrl: addon.slugOrUrl,
      createdByUserId: gmUserId,
      ...set,
    })
    .onConflictDoUpdate({ target: [ga.guildId, ga.source, ga.slugOrUrl], set })
    .returning({ id: ga.id });
  return defined(row, `seed-guild addon ${addon.slugOrUrl}`).id;
}

/** Seed (or restore) the profile + the two addons; drops any other addon. */
export async function seedGuildContent(
  db: Db,
  guildId: number,
  gmUserId: number,
  now: Date,
): Promise<SeedGuildContent> {
  await upsertProfile(db, guildId, gmUserId, now);
  const postIds = await seedHubPosts(
    db,
    { guildId, gmUserId, legacyBody: SEED_GUILD_GM_POST },
    now,
  );
  const addonIds: number[] = [];
  for (const [i, addon] of SEED_GUILD_ADDONS.entries()) {
    addonIds.push(await upsertAddon(db, guildId, addon, i, gmUserId));
  }
  const ga = schema.guildRecommendedAddons;
  await db
    .delete(ga)
    .where(and(eq(ga.guildId, guildId), notInArray(ga.id, addonIds)));
  return { gmPost: SEED_GUILD_GM_POST, addonIds, postIds };
}
