/**
 * ROK-2147 — the optional `withInstalledAddons: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: a `character_installed_addons`
 * row on the `member` role's character, as a LedgerLink char export would
 * leave it. Against the `withContent` recommendations (folder names
 * `Details` — Required — and `WeakAuras`) plus the LedgerLink pin, the card
 * reads: LedgerLink + WeakAuras Installed, Details Missing (a missing
 * Required), and 7 unmatched folders under "Also installed" (> the 5-row
 * cap, so "Show all 7"). Idempotent: a re-seed rewrites the row.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonInstalled } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Loaded entries first, as the addon exports them. */
export const SEED_INSTALLED_ADDONS: readonly AddonInstalled[] = [
  { name: 'LedgerLink', title: 'LedgerLink', version: '1.4.0', loaded: true },
  { name: 'WeakAuras', title: 'WeakAuras', version: '5.12.0', loaded: true },
  { name: 'Questie', title: 'Questie', version: '9.5.1', loaded: true },
  { name: 'Bagnon', title: 'Bagnon', version: '10.2.3', loaded: true },
  { name: 'Auctionator', title: 'Auctionator', loaded: true },
  {
    name: 'DBM-Core',
    title: 'Deadly Boss Mods',
    version: '1.15.2',
    loaded: true,
  },
  { name: 'OmniCC', title: 'OmniCC', loaded: true },
  {
    name: 'Leatrix_Plus',
    title: 'Leatrix Plus',
    version: '1.15.40',
    loaded: false,
  },
  { name: 'ClassicCastbars', loaded: false },
];

/** Fixed fake sha — the seed is not an export string. */
const SEED_SHA = 'f'.repeat(64);

export interface SeededInstalledAddons {
  characterId: string;
  /** Folder names, in stored order. */
  names: string[];
}

export async function seedInstalledAddons(
  db: Db,
  characterId: string,
  now: Date,
): Promise<SeededInstalledAddons> {
  const t = schema.characterInstalledAddons;
  const set = {
    addons: [...SEED_INSTALLED_ADDONS],
    capturedAt: now,
    importedAt: now,
    payloadSha256: SEED_SHA,
  };
  await db
    .insert(t)
    .values({ characterId, ...set })
    .onConflictDoUpdate({ target: t.characterId, set });
  return { characterId, names: SEED_INSTALLED_ADDONS.map((a) => a.name) };
}
