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

export interface BuildSummary {
  rowsPerInstance: Record<string, number>;
  skipped: ParseSkip[];
  notShown: number[];
  zoneReports: string[];
  nullInstancePrereqs: number;
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
  state.rows.set(result.row.questId, result.row);
  for (const step of parsed.series) {
    if (step.questId !== null) state.prereqs.set(step.questId, step.name);
  }
  return result.row;
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
    if (await importQuest(source, state, zoneRow, seedN)) count++;
  }
  state.summary.rowsPerInstance[instanceName] = count;
}

function emptyState(): BuildState {
  const summary: BuildSummary = {
    rowsPerInstance: {},
    skipped: [],
    notShown: [],
    zoneReports: [],
    nullInstancePrereqs: 0,
  };
  return { rows: new Map(), prereqs: new Map(), summary };
}

/** Build every row (zone quests, then out-of-zone pre-reqs), sorted by questId. */
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
      state.summary.nullInstancePrereqs++;
    }
  }
  const rows = [...state.rows.values()].sort((a, b) => a.questId - b.questId);
  return { rows, summary: state.summary };
}
