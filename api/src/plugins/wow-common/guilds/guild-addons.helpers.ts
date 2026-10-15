import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  GuildAddon,
  GuildAddonFlavor,
  GuildAddonRequirement,
  GuildAddonSource,
  UpdateGuildAddonInput,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type {
  GuildRecommendedAddonInsert,
  GuildRecommendedAddonSelect,
} from '../../../drizzle/schema/guild-recommended-addons';
import { addonLinkUrl, type ParsedAddonLink } from './guild-addon-url.helpers';

/**
 * ROK-1786 — `guild_recommended_addons` queries. Every read/write is scoped
 * by guild id, so an addon id from another guild never matches (no IDOR).
 */

type Db = PostgresJsDatabase<typeof schema>;
type AddonRow = GuildRecommendedAddonSelect;
type AddonUpdate = Partial<GuildRecommendedAddonInsert>;

const { guildRecommendedAddons: ga } = schema;

export function toGuildAddon(row: AddonRow): GuildAddon {
  const source = row.source as GuildAddonSource;
  return {
    id: row.id,
    guildId: row.guildId,
    source,
    slugOrUrl: row.slugOrUrl,
    url: addonLinkUrl(source, row.slugOrUrl),
    displayName: row.displayName,
    note: row.note,
    requirement: row.requirement as GuildAddonRequirement,
    flavor: (row.flavor as GuildAddonFlavor | null) ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function listAddonRows(db: Db, guildId: number): Promise<AddonRow[]> {
  return db
    .select()
    .from(ga)
    .where(eq(ga.guildId, guildId))
    .orderBy(asc(ga.sortOrder), asc(ga.id));
}

export async function findAddonRow(
  db: Db,
  guildId: number,
  addonId: number,
): Promise<AddonRow | undefined> {
  const [row] = await db
    .select()
    .from(ga)
    .where(and(eq(ga.id, addonId), eq(ga.guildId, guildId)))
    .limit(1);
  return row;
}

/** True when the guild already lists this link (optionally not `exceptId`). */
export async function hasAddonCollision(
  db: Db,
  guildId: number,
  link: Pick<ParsedAddonLink, 'source' | 'slugOrUrl'>,
  exceptId?: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: ga.id })
    .from(ga)
    .where(
      and(
        eq(ga.guildId, guildId),
        eq(ga.source, link.source),
        eq(ga.slugOrUrl, link.slugOrUrl),
        exceptId === undefined ? undefined : ne(ga.id, exceptId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Row count and the next free `sort_order` (appends at the end). */
export async function addonStats(
  db: Db,
  guildId: number,
): Promise<{ count: number; nextSort: number }> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      maxSort: sql<number | null>`max(${ga.sortOrder})`,
    })
    .from(ga)
    .where(eq(ga.guildId, guildId));
  const maxSort = row?.maxSort ?? null;
  return {
    count: row?.count ?? 0,
    nextSort: maxSort === null ? 0 : maxSort + 1,
  };
}

export async function insertAddon(
  db: Db,
  values: GuildRecommendedAddonInsert,
): Promise<AddonRow | undefined> {
  const [row] = await db.insert(ga).values(values).returning();
  return row;
}

export async function updateAddonRow(
  db: Db,
  guildId: number,
  addonId: number,
  set: AddonUpdate,
): Promise<AddonRow | undefined> {
  const [row] = await db
    .update(ga)
    .set(set)
    .where(and(eq(ga.id, addonId), eq(ga.guildId, guildId)))
    .returning();
  return row;
}

export async function deleteAddonRow(
  db: Db,
  guildId: number,
  addonId: number,
): Promise<boolean> {
  const rows = await db
    .delete(ga)
    .where(and(eq(ga.id, addonId), eq(ga.guildId, guildId)))
    .returning({ id: ga.id });
  return rows.length > 0;
}

/** Rewrite `sort_order` to the position of each id (one transaction). */
export async function writeAddonOrder(
  db: Db,
  guildId: number,
  ids: number[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx
        .update(ga)
        .set({ sortOrder: index })
        .where(and(eq(ga.id, id), eq(ga.guildId, guildId)));
    }
  });
}

/** Same members, ignoring order (the reorder body must be the whole set). */
export function isSameIdSet(stored: number[], sent: number[]): boolean {
  if (stored.length !== sent.length) return false;
  const have = new Set(stored);
  return sent.every((id) => have.has(id));
}

/** Column set for a PATCH: only the keys sent; a new link re-parses source. */
export function buildAddonUpdate(
  input: UpdateGuildAddonInput,
  link: ParsedAddonLink | null,
  userId: number,
  now: Date,
): AddonUpdate {
  const set: AddonUpdate = { updatedByUserId: userId, updatedAt: now };
  if (link) {
    set.source = link.source;
    set.slugOrUrl = link.slugOrUrl;
  }
  if (input.displayName !== undefined) set.displayName = input.displayName;
  if (input.note !== undefined) set.note = blankToNull(input.note);
  if (input.requirement !== undefined) set.requirement = input.requirement;
  if (input.flavor !== undefined) set.flavor = input.flavor;
  return set;
}

export function blankToNull(value: string | null | undefined): string | null {
  return value ? value : null;
}
