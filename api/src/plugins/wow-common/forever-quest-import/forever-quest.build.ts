/**
 * ROK-1748: assemble the Forever dungeon-quest dataset from a page source
 * (captured fixtures or the live, rate-limited Wowhead fetcher). Pure apart
 * from the injected source; used by `api/scripts/prepare-forever-dungeon-quests.ts`.
 */
import {
  FOREVER_INSTANCES,
  FOREVER_SEED_ID_BASE,
} from '../forever-instance-data';
import {
  parseQuestPage,
  parseZoneQuestList,
  toDungeonQuestRow,
  type DungeonQuestRow,
  type ParseSkip,
} from './forever-quest.parse';

/** Supplies raw HTML; null = no page (missing fixture / unmapped zone). */
export interface QuestPageSource {
  zonePage(seedN: number): Promise<string | null>;
  questPage(questId: number): Promise<string | null>;
}

/** A zone row whose level sits >5 above its seed instance's band max. */
export interface OutOfBandRow {
  questId: number;
  name: string;
  questLevel: number;
  seedN: number;
}

/** Levels a zone quest may exceed its seed's `maximumLevel` before it is reported. */
const BAND_SLACK = 5;

export interface BuildSummary {
  rowsPerInstance: Record<string, number>;
  skipped: ParseSkip[];
  notShown: number[];
  zoneReports: string[];
  /** Out-of-zone chain steps (pre-reqs or later steps) imported with a null instance. */
  nullInstanceSteps: number;
  /** Reported, still written — the Lead re-keys by hand. */
  outOfBand: OutOfBandRow[];
}

interface BuildState {
  rows: Map<number, DungeonQuestRow>;
  prereqs: Map<number, string>;
  summary: BuildSummary;
}

const TITLE_RE = /<title>([^<]*)<\/title>/;

async function importQuest(
  source: QuestPageSource,
  state: BuildState,
  zoneRow: { id: number; name: string },
  seedN: number | null,
): Promise<DungeonQuestRow | null> {
  const html = await source.questPage(zoneRow.id);
  const parsed =
    html === null ? null : parseQuestPage(html, { env: 'forever' });
  if (parsed === null) {
    const reason = html === null ? 'quest page missing' : 'infobox not found';
    state.summary.skipped.push({ id: zoneRow.id, reason });
    return null;
  }
  const result = toDungeonQuestRow(zoneRow, parsed, seedN);
  if (!result.ok) {
    state.summary.skipped.push(result.skip);
    return null;
  }
  if (parsed.seriesIssue)
    state.summary.skipped.push({ id: zoneRow.id, reason: parsed.seriesIssue });
  state.rows.set(result.row.questId, result.row);
  for (const step of parsed.series) {
    if (step.questId !== null) state.prereqs.set(step.questId, step.name);
  }
  return result.row;
}

function checkBand(
  state: BuildState,
  row: DungeonQuestRow,
  seedN: number,
): void {
  const max = FOREVER_INSTANCES.find(
    (i) => i.id === FOREVER_SEED_ID_BASE + seedN,
  )?.maximumLevel;
  if (max === undefined || row.questLevel === null) return;
  if (row.questLevel <= max + BAND_SLACK) return;
  const { questId, name, questLevel } = row;
  state.summary.outOfBand.push({ questId, name, questLevel, seedN });
}

async function importZone(
  source: QuestPageSource,
  state: BuildState,
  seedN: number,
  instanceName: string,
): Promise<void> {
  const html = await source.zonePage(seedN);
  if (html === null) return;
  const title = TITLE_RE.exec(html)?.[1] ?? '';
  if (!title.includes(instanceName)) {
    state.summary.zoneReports.push(
      `zone ${seedN} skipped: title "${title}" lacks "${instanceName}"`,
    );
    return;
  }
  const list = parseZoneQuestList(html);
  state.summary.skipped.push(...list.skipped);
  state.summary.notShown.push(...list.notShown.map((r) => r.id));
  let count = 0;
  for (const zoneRow of list.rows) {
    if (state.rows.has(zoneRow.id)) continue;
    const row = await importQuest(source, state, zoneRow, seedN);
    if (!row) continue;
    checkBand(state, row, seedN);
    count++;
  }
  state.summary.rowsPerInstance[instanceName] = count;
}

function emptyState(): BuildState {
  const summary: BuildSummary = {
    rowsPerInstance: {},
    skipped: [],
    notShown: [],
    zoneReports: [],
    nullInstanceSteps: 0,
    outOfBand: [],
  };
  return { rows: new Map(), prereqs: new Map(), summary };
}

/** Build every row (zone quests, then out-of-zone chain steps), sorted by questId. */
export async function buildForeverQuestDataset(
  source: QuestPageSource,
): Promise<{ rows: DungeonQuestRow[]; summary: BuildSummary }> {
  const state = emptyState();
  for (const instance of FOREVER_INSTANCES) {
    await importZone(
      source,
      state,
      instance.id - FOREVER_SEED_ID_BASE,
      instance.name,
    );
  }
  for (const [id, name] of state.prereqs) {
    if (state.rows.has(id)) continue;
    if (await importQuest(source, state, { id, name }, null)) {
      state.summary.nullInstanceSteps++;
    }
  }
  const rows = [...state.rows.values()].sort((a, b) => a.questId - b.questId);
  return { rows, summary: state.summary };
}
