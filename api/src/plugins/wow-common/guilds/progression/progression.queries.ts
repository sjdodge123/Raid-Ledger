/**
 * ROK-1789 Part B (B-3) — read-only queries behind the Progression tab's
 * `progression` half. Pulls use the widget's scope + trust filter
 * (`guildPullsWhere`: D2 hub scope, Q1 trusted reporters) and add the
 * pull's map id; boss rows are the small `forever`/`classic` slice of
 * `wow_classic_bosses` (Q-B11; ~220 rows, uncached in v1 per Q-B20).
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowGuildProgressionDto } from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import {
  guildPullsWhere,
  raidScope,
  type RaidHubRow,
  type RaidScope,
} from '../roster-insights/roster-insights.raid-progress';
import {
  groupIntoInstances,
  type ProgressionBossRow,
  type ProgressionPull,
} from './progression-instances.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Boss-row expansions whose totals the tab reads (forever first, Q-B11). */
const PROGRESSION_EXPANSIONS = ['forever', 'classic'];

/** A fresh empty `progression` (a non-guild hub, or a guild without pulls). */
export function emptyGuildProgression(): WowGuildProgressionDto {
  return { instances: [], pullCount: 0, lastPullAt: null };
}

/** `forever` + `classic` boss rows (Journal `instanceId`, name, order). */
export async function loadBossRows(db: Db): Promise<ProgressionBossRow[]> {
  const b = schema.wowClassicBosses;
  return db
    .select({
      instanceId: b.instanceId,
      name: b.name,
      order: b.order,
      expansion: b.expansion,
    })
    .from(b)
    .where(inArray(b.expansion, PROGRESSION_EXPANSIONS));
}

/** In-scope pulls by a trusted reporter, with the pull's map id. */
export async function loadProgressionPulls(
  db: Db,
  scope: RaidScope,
  reporterIds: readonly number[],
): Promise<ProgressionPull[]> {
  const p = schema.addonEncounterPulls;
  return db
    .select({
      encounterId: p.encounterId,
      encounterName: p.encounterName,
      difficultyId: p.difficultyId,
      instanceId: p.instanceId,
      startAt: p.startAt,
      endAt: p.endAt,
      success: p.success,
    })
    .from(p)
    .where(guildPullsWhere(scope, reporterIds));
}

/**
 * The Progression tab's `progression` half for a hub. `hub` is the guild row
 * the service already read (`loadInsightsHubRow`); `reporterIds` are the
 * owners of the FULL roster's linked characters (`linkedOwners`), exactly as
 * the Raid progress widget passes them. Empty for a non-guild hub.
 */
export async function loadGuildProgression(
  db: Db,
  hub: RaidHubRow | null,
  reporterIds: readonly number[],
): Promise<WowGuildProgressionDto> {
  const scope = raidScope(hub);
  if (!scope) return emptyGuildProgression();
  const reporters = [...new Set(reporterIds)];
  const [pulls, bossRows] = await Promise.all([
    loadProgressionPulls(db, scope, reporters),
    loadBossRows(db),
  ]);
  return groupIntoInstances(pulls, bossRows);
}
