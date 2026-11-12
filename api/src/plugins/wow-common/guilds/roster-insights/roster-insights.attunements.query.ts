import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowRosterAttunementsDto } from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import {
  FOREVER_ATTUNEMENTS,
  attunementExtraQuestIds,
} from '../../data/forever-attunements';
import {
  factionOfColumn,
  type AttunementFactionSide,
} from '../../attunement-evaluate';
import { loadForeverQuestSources } from '../../forever-quest-source.query';
import { mainsOnly } from './roster-insights.helpers';
import {
  computeAttunements,
  rosterFaction,
  toAttunementMember,
} from './roster-insights.attunements';
import type { InsightRow } from './roster-insights.types';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1927 (P3) — the attunement quest ids Blizzard confirmed: those with a
 * stored Forever quest row (ROK-2143 import, which fetches the extra ids).
 */
export async function loadConfirmedAttunementIds(db: Db): Promise<Set<number>> {
  const q = schema.wowDungeonQuestBlizzard;
  const rows = await db
    .select({ id: q.questId })
    .from(q)
    .where(inArray(q.questId, attunementExtraQuestIds()));
  return new Set(rows.map((r) => r.id));
}

/** Claimed characters' stored faction column (the race-unknown fallback). */
async function loadStoredSides(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, AttunementFactionSide>> {
  if (ids.length === 0) return new Map();
  const c = schema.characters;
  const rows = await db
    .select({ id: c.id, faction: c.faction })
    .from(c)
    .where(inArray(c.id, [...ids]));
  const sides = new Map<string, AttunementFactionSide>();
  for (const r of rows) {
    const side = factionOfColumn(r.faction);
    if (side) sides.set(r.id, side);
  }
  return sides;
}

/**
 * The members-only `attunements` section over the roster's MAINS (ruling D:
 * a linked user's main row plus every unclaimed member). Quests are loaded
 * only for claimed characters; nothing loads while no id is confirmed.
 */
export async function loadAttunements(
  db: Db,
  all: readonly InsightRow[],
): Promise<WowRosterAttunementsDto> {
  const confirmed = await loadConfirmedAttunementIds(db);
  if (confirmed.size === 0)
    return computeAttunements(FOREVER_ATTUNEMENTS, confirmed, []);
  const mains = mainsOnly(all);
  const ids = mains.flatMap((r) => (r.characterId ? [r.characterId] : []));
  const [quests, stored] = await Promise.all([
    loadForeverQuestSources(db, ids),
    loadStoredSides(db, ids),
  ]);
  const side = rosterFaction(mains);
  const members = mains.map((r) => toAttunementMember(r, quests, side, stored));
  return computeAttunements(FOREVER_ATTUNEMENTS, confirmed, members);
}
