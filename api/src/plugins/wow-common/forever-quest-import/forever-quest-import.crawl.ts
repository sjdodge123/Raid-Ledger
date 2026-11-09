/**
 * ROK-2143: one Forever quest import crawl — `quest/index` (verifies the area
 * map by name), `quest/area/{id}` per mapped dungeon, then `quest/{id}` for
 * every listed quest, every quest of ours the area did not list, and their
 * prerequisites (visited set, depth cap). Every request re-checks the kill
 * switch and is spaced {@link FOREVER_QUEST_IMPORT_SPACING_MS}; a fatal
 * status throws {@link QuestImportAbort} and keeps what was written.
 */
import type { WowDungeonQuestBlizzardInsert } from '../../../drizzle/schema/dungeon-quest-blizzard';
import {
  buildClassicItemUrl,
  buildQuestAreaUrl,
  buildQuestIndexUrl,
  buildQuestUrl,
  collectRequirementKeyPaths,
  parseBlizzardQuest,
  parseQuestAreaQuests,
  parseQuestIndexAreas,
  type BlizzardRef,
  type ParsedBlizzardQuest,
} from './blizzard-quest.parse';
import {
  CLASSIC_QUEST_AREAS,
  areaNameMatches,
  classicQuestAreaInstanceIds,
} from './classic-quest-areas';
import { FOREVER_QUEST_IMPORT_OFF_MESSAGE } from './forever-quest-import-switch';
import {
  FOREVER_QUEST_IMPORT_MAX_DEPTH,
  FOREVER_QUEST_IMPORT_SPACING_MS,
  QuestImportAbort,
  isFatalQuestImportStatus,
  pushQuestImportError,
  type ForeverQuestImportReport,
} from './forever-quest-import.report';

export interface QuestImportResponse {
  status: number;
  body: unknown;
}

/** What a crawl needs from the outside world (the service supplies it). */
export interface QuestImportDeps {
  region: string;
  runId: string;
  /** Our bundled quests: quest id → dungeon instance id. */
  knownQuests: ReadonlyMap<number, number>;
  fetchJson(url: string): Promise<QuestImportResponse>;
  pause(ms: number): Promise<void>;
  isEnabled(): Promise<boolean>;
  saveQuest(row: WowDungeonQuestBlizzardInsert): Promise<void>;
}

interface QueuedQuest {
  questId: number;
  areaId: number;
  instanceId: number | null;
  depth: number;
  unlisted: boolean;
}

/** The overlay row for one parsed `quest/{id}` response. */
export function toOverlayRow(
  parsed: ParsedBlizzardQuest,
  item: Pick<QueuedQuest, 'areaId' | 'instanceId'>,
  runId: string,
  fetchedAt: Date,
): WowDungeonQuestBlizzardInsert {
  return {
    questId: parsed.questId,
    areaId: parsed.area?.id ?? item.areaId,
    dungeonInstanceId: item.instanceId,
    title: parsed.title,
    typeId: parsed.typeId,
    rewardXp: parsed.rewardXp,
    rewardMoneyCopper: parsed.rewardMoneyCopper,
    rewardItems: parsed.rewardItems,
    reputations: parsed.reputations,
    requirementsRaw: parsed.requirementsRaw,
    raw: parsed.raw,
    fetchedAt,
    runId,
  };
}

/** `level` of a classic item response, else null. */
function itemLevelOf(body: unknown): number | null {
  if (typeof body !== 'object' || body === null || !('level' in body)) {
    return null;
  }
  return typeof body.level === 'number' ? body.level : null;
}

export class QuestImportCrawl {
  private readonly seen = new Set<number>();
  private readonly queue: QueuedQuest[] = [];
  private readonly keyPaths = new Set<string>();
  private itemProbeId: number | null = null;

  constructor(
    private readonly deps: QuestImportDeps,
    readonly report: ForeverQuestImportReport,
  ) {}

  async run(): Promise<void> {
    const index = await this.request(
      buildQuestIndexUrl(this.deps.region),
      'quest/index',
    );
    if (index === null) throw new QuestImportAbort('quest/index: no data');
    const imported = await this.listAreas(parseQuestIndexAreas(index));
    this.enqueueUnlisted(imported);
    for (let q = this.queue.shift(); q; q = this.queue.shift()) {
      await this.importQuest(q);
    }
    this.report.requirementKeyPaths = [...this.keyPaths].sort();
    await this.probeItemLevel();
  }

  /** Kill switch, spacing, then one GET. */
  private async requestRaw(url: string): Promise<QuestImportResponse> {
    if (!(await this.deps.isEnabled())) {
      throw new QuestImportAbort(FOREVER_QUEST_IMPORT_OFF_MESSAGE);
    }
    if (this.report.counts.requests > 0) {
      await this.deps.pause(FOREVER_QUEST_IMPORT_SPACING_MS);
    }
    this.report.counts.requests += 1;
    return this.deps.fetchJson(url);
  }

  /** Body on 200; null (+ an error line) on a non-fatal miss; throws on fatal. */
  private async request(url: string, label: string): Promise<unknown> {
    const res = await this.requestRaw(url);
    if (isFatalQuestImportStatus(res.status)) {
      throw new QuestImportAbort(`${label}: HTTP ${res.status}`);
    }
    if (res.status === 200) return res.body;
    pushQuestImportError(this.report, `${label}: HTTP ${res.status}`);
    return null;
  }

  /** Verify + list each mapped area; returns the instance ids imported. */
  private async listAreas(areas: BlizzardRef[]): Promise<Set<number>> {
    const imported = new Set<number>();
    for (const instanceId of classicQuestAreaInstanceIds()) {
      const entry = CLASSIC_QUEST_AREAS[instanceId];
      if (!entry) continue;
      const actual = areas.find((a) => a.id === entry.areaId);
      if (!actual || !areaNameMatches(entry, actual.name)) {
        const { dungeon, areaId } = entry;
        const actualName = actual?.name ?? null;
        this.report.mismatchedAreas.push({
          instanceId,
          dungeon,
          areaId,
          actualName,
        });
        continue;
      }
      if (await this.listArea(instanceId, entry.areaId))
        imported.add(instanceId);
    }
    return imported;
  }

  /** `quest/area/{id}` → queue its quests; false when the area had no data. */
  private async listArea(instanceId: number, areaId: number): Promise<boolean> {
    const body = await this.request(
      buildQuestAreaUrl(this.deps.region, areaId),
      `quest/area/${areaId}`,
    );
    if (body === null) return false;
    this.report.counts.areasImported += 1;
    for (const quest of parseQuestAreaQuests(body)) {
      this.report.counts.questsListed += 1;
      this.enqueue({
        questId: quest.id,
        areaId,
        instanceId,
        depth: 0,
        unlisted: false,
      });
    }
    return true;
  }

  /** Our quests in an imported dungeon that its area did not list. */
  private enqueueUnlisted(imported: Set<number>): void {
    for (const [questId, instanceId] of this.deps.knownQuests) {
      const entry = CLASSIC_QUEST_AREAS[instanceId];
      if (!entry || !imported.has(instanceId)) continue;
      this.enqueue({
        questId,
        areaId: entry.areaId,
        instanceId,
        depth: 0,
        unlisted: true,
      });
    }
  }

  private enqueue(item: QueuedQuest): void {
    if (this.seen.has(item.questId)) return;
    this.seen.add(item.questId);
    this.queue.push(item);
  }

  private async importQuest(item: QueuedQuest): Promise<void> {
    const label = `quest/${item.questId}`;
    const body = await this.request(
      buildQuestUrl(this.deps.region, item.questId),
      label,
    );
    if (body === null) return;
    const parsed = parseBlizzardQuest(body);
    if (!parsed) {
      pushQuestImportError(this.report, `${label}: unparseable response`);
      return;
    }
    if (item.unlisted) {
      this.report.unlistedQuests.push({
        questId: item.questId,
        areaId: parsed.area?.id ?? null,
      });
    }
    await this.deps.saveQuest(
      toOverlayRow(parsed, item, this.deps.runId, new Date()),
    );
    this.tally(item, parsed);
    this.enqueuePrerequisites(item, parsed);
  }

  /** Follow `requirements` prerequisites up to the depth cap. */
  private enqueuePrerequisites(
    item: QueuedQuest,
    parsed: ParsedBlizzardQuest,
  ): void {
    if (item.depth >= FOREVER_QUEST_IMPORT_MAX_DEPTH) return;
    for (const prereq of parsed.prerequisiteIds) {
      const instanceId = this.deps.knownQuests.get(prereq) ?? null;
      this.enqueue({
        questId: prereq,
        areaId: item.areaId,
        instanceId,
        depth: item.depth + 1,
        unlisted: false,
      });
    }
  }

  private tally(item: QueuedQuest, parsed: ParsedBlizzardQuest): void {
    const counts = this.report.counts;
    if (item.depth === 0) counts.questsFetched += 1;
    else counts.prerequisitesFetched += 1;
    counts.upserted += 1;
    for (const path of collectRequirementKeyPaths(parsed.requirementsRaw)) {
      this.keyPaths.add(path);
    }
    this.itemProbeId ??= parsed.rewardItems[0]?.id ?? null;
  }

  /** R8=B: one classic 1.x item lookup; any status is recorded, never fatal. */
  private async probeItemLevel(): Promise<void> {
    const itemId = this.itemProbeId;
    if (itemId === null) return;
    const res = await this.requestRaw(
      buildClassicItemUrl(this.deps.region, itemId),
    );
    const itemLevel = res.status === 200 ? itemLevelOf(res.body) : null;
    this.report.itemLevelProbe = { itemId, httpStatus: res.status, itemLevel };
  }
}
