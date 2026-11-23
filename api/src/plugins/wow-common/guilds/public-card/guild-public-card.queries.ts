/**
 * ROK-1813 — the public card columns on `guild_profiles` (no access logic).
 * Writes touch ONLY `public_card_enabled` / `public_card_slug` + `updated_at`.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildPublicCardSettings } from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import { generateCardSlug } from './guild-public-card.helpers';

export type Db = PostgresJsDatabase<typeof schema>;

const { guildProfiles: profiles, guilds, games } = schema;

/** Fresh slugs tried before giving up (62^16 space — a repeat is ~impossible). */
const SLUG_ATTEMPTS = 5;

/** What the public read needs, before shaping (D5). */
export interface PublicCardRow {
  name: string;
  region: string;
  realmSlug: string | null;
  rawRealm: string | null;
  memberCount: number;
  gameName: string;
  recruitment: unknown;
}

/**
 * The card behind `slug` — ONLY when it is switched on, the hub is a visible
 * `wow_guild`. Anything else (unknown, off, hidden, other kind) → null.
 */
export async function findPublicCardRow(
  db: Db,
  slug: string,
): Promise<PublicCardRow | null> {
  const [row] = await db
    .select({
      name: guilds.name,
      region: guilds.region,
      realmSlug: guilds.realmSlug,
      rawRealm: guilds.rawRealm,
      memberCount: guilds.memberCount,
      gameName: games.name,
      recruitment: profiles.recruitment,
    })
    .from(profiles)
    .innerJoin(guilds, eq(guilds.id, profiles.guildId))
    .innerJoin(games, eq(games.id, guilds.gameId))
    .where(
      and(
        eq(profiles.publicCardSlug, slug),
        eq(profiles.publicCardEnabled, true),
        eq(guilds.kind, 'wow_guild'),
        isNull(guilds.hiddenAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The editor view; no profile row ⇒ off with no slug (AC1). */
export async function findCardSettings(
  db: Db,
  guildId: number,
): Promise<GuildPublicCardSettings> {
  const [row] = await db
    .select({
      enabled: profiles.publicCardEnabled,
      slug: profiles.publicCardSlug,
    })
    .from(profiles)
    .where(eq(profiles.guildId, guildId));
  return row ?? { enabled: false, slug: null };
}

/** A slug no other card holds — PRE-CHECKED, never catch-and-retry (shared tx rule). */
async function freeSlug(db: Db): Promise<string> {
  for (let i = 0; i < SLUG_ATTEMPTS; i += 1) {
    const slug = generateCardSlug();
    const [taken] = await db
      .select({ guildId: profiles.guildId })
      .from(profiles)
      .where(eq(profiles.publicCardSlug, slug))
      .limit(1);
    if (!taken) return slug;
  }
  throw new Error('could not mint a free public card slug');
}

/**
 * Switch the card on: upserts the profile row; a slug is minted only when
 * the row has none, so off → on keeps the same link (D1).
 */
export async function enablePublicCard(
  db: Db,
  guildId: number,
): Promise<GuildPublicCardSettings> {
  const current = await findCardSettings(db, guildId);
  const slug = current.slug ?? (await freeSlug(db));
  const set = {
    publicCardEnabled: true,
    publicCardSlug: sql`COALESCE(${profiles.publicCardSlug}, ${slug})`,
    updatedAt: new Date(),
  };
  await db
    .insert(profiles)
    .values({ guildId, publicCardEnabled: true, publicCardSlug: slug })
    .onConflictDoUpdate({ target: profiles.guildId, set });
  return findCardSettings(db, guildId);
}

/** Switch the card off; the slug is kept. Never inserts an empty row. */
export async function disablePublicCard(
  db: Db,
  guildId: number,
): Promise<GuildPublicCardSettings> {
  await db
    .update(profiles)
    .set({ publicCardEnabled: false, updatedAt: new Date() })
    .where(eq(profiles.guildId, guildId));
  return findCardSettings(db, guildId);
}
