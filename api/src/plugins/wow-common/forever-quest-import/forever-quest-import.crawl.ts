/**
 * ROK-2143: one Forever quest import crawl — the area list (`quest/index`
 * `areas[]` when inline, else `quest/area/index`, which the documented
 * `quest/index` only links to; verifies the area map by name; no areas, or
 * no mapped area found, fails the run), `quest/area/{id}` per mapped
 * dungeon, then `quest/{id}` for
 * every listed quest, every quest of ours the area did not list, and their
 * prerequisites (visited set, depth cap). Every request re-checks the kill
 * switch and is spaced {@link FOREVER_QUEST_IMPORT_SPACING_MS}; a fatal
 * status throws {@link QuestImportAbort} and keeps what was written.
 */
import type {
  ForeverQuestImportMismatchedArea,
  ForeverQuestImportSampleQuest,
} from '@raid-ledger/contract';
import type { WowDungeonQuestBlizzardInsert } from '../../../drizzle/schema/dungeon-quest-blizzard';
import {
  buildClassicItemUrl,
  buildQuestAreaIndexUrl,
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
import { toOverlayRow } from './forever-quest-import.overlay-row';
import {
  CLASSIC_QUEST_AREAS,
  areaNameCandidates,
  areaNameMatches,
  classicQuestAreaInstanceIds,
  firstKnownQuestId,
  type ClassicQuestArea,
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
import { itemLevelOf, recordProbeFailure } from './forever-quest-import.probe';

/** Error line when neither index yields an area (run ends `failed`). */
export const QUEST_IMPORT_NO_AREAS_MESSAGE =
  'Quest area list empty: quest/index and quest/area/index listed no areas';

/** Error line when no mapped dungeon area is in the list (run ends `failed`). */
export function questImportNoMappedAreasMessage(mapped: number): string {
  return `None of the ${mapped} mapped dungeon areas is in Blizzard's quest area list (ids or names differ, see mismatchedAreas)`;
}

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
  /**
   * ROK-1927: quest ids fetched besides the dungeon areas (the attunement
   * chains, mostly open-world) so Blizzard confirms each; stored like
   * prerequisites (no dungeon, area from the response).
   */
  extraQuestIds?: readonly number[];
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

/** An extra id's queue fields: area 0 is kept only when Blizzard names none. */
const EXTRA_QUEST = { areaId: 0, depth: 0, unlisted: false } as const;

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
    const areas = await this.loadAreaList();
    if (areas.length === 0) {
      throw new QuestImportAbort(QUEST_IMPORT_NO_AREAS_MESSAGE);
    }
    const imported = await this.listAreas(areas);
    this.assertSomeAreaMapped();
    this.enqueueUnlisted(imported);
    this.enqueueExtra();
    for (let q = this.queue.shift(); q; q = this.queue.shift()) {
      await this.importQuest(q);
    }
    this.report.requirementKeyPaths = [...this.keyPaths].sort();
    await this.probeItemLevel();
  }

  /**
   * `quest/index` `areas[]` when it lists them inline; otherwise (the
   * documented `areas: { href }` link) `quest/area/index`. The link is never
   * followed: the URL is rebuilt on the pinned host + static-forever namespace.
   */
  private async loadAreaList(): Promise<BlizzardRef[]> {
    const { region } = this.deps;
    const index = await this.request(buildQuestIndexUrl(region), 'quest/index');
    if (index === null) throw new QuestImportAbort('quest/index: no data');
    const inline = parseQuestIndexAreas(index);
    if (inline.length > 0) return inline;
    const label = 'quest/area/index';
    const list = await this.request(buildQuestAreaIndexUrl(region), label);
    if (list === null) throw new QuestImportAbort(`${label}: no data`);
    return parseQuestIndexAreas(list);
  }

  /** Every mapped area missing or misnamed = a broken map, not a success. */
  private assertSomeAreaMapped(): void {
    const mapped = classicQuestAreaInstanceIds().length;
    if (mapped > 0 && this.report.mismatchedAreas.length >= mapped) {
      throw new QuestImportAbort(questImportNoMappedAreasMessage(mapped));
    }
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
        this.report.mismatchedAreas.push(
          await this.describeMismatch(instanceId, entry, areas, actual),
        );
        continue;
      }
      if (await this.listArea(instanceId, entry.areaId))
        imported.add(instanceId);
    }
    return imported;
  }

  /**
   * A skipped dungeon, with the evidence needed to fix its area id: the
   * name-alike areas Blizzard lists and the area one of our quests is filed
   * under (nothing is imported for it).
   */
  private async describeMismatch(
    instanceId: number,
    entry: ClassicQuestArea,
    areas: BlizzardRef[],
    actual: BlizzardRef | undefined,
  ): Promise<ForeverQuestImportMismatchedArea> {
    const nameMatches = areaNameCandidates(entry, areas);
    const sampleQuest = await this.probeSampleQuest(instanceId);
    return {
      instanceId,
      dungeon: entry.dungeon,
      areaId: entry.areaId,
      actualName: actual?.name ?? null,
      ...(nameMatches.length > 0 ? { nameMatches } : {}),
      ...(sampleQuest ? { sampleQuest } : {}),
    };
  }

  /**
   * One `quest/{id}` of a skipped dungeon: its status and Blizzard area.
   * Evidence only, never fatal (M1, like `probeItemLevel`): any status is
   * recorded; a thrown request is recorded as `httpStatus` 0 (no HTTP
   * response) plus an error line. Only the kill switch still stops the run
   * here — that is the operator's stop, not a probe failure.
   */
  private async probeSampleQuest(
    instanceId: number,
  ): Promise<ForeverQuestImportSampleQuest | null> {
    const questId = firstKnownQuestId(this.deps.knownQuests, instanceId);
    if (questId === null) return null;
    const url = buildQuestUrl(this.deps.region, questId);
    const res = await this.requestRaw(url).catch((e: unknown) =>
      recordProbeFailure(this.report, `quest/${questId}`, e),
    );
    const area =
      res?.status === 200 ? (parseBlizzardQuest(res.body)?.area ?? null) : null;
    return {
      questId,
      httpStatus: res?.status ?? 0,
      areaId: area?.id ?? null,
      areaName: area?.name ?? null,
    };
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

  /** ROK-1927 extra ids (see {@link EXTRA_QUEST}). */
  private enqueueExtra(): void {
    const known = this.deps.knownQuests;
    for (const questId of this.deps.extraQuestIds ?? []) {
      const instanceId = known.get(questId) ?? null;
      this.enqueue({ ...EXTRA_QUEST, questId, instanceId });
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

  /**
   * R8=B: one classic 1.x item lookup; any status is recorded, never fatal.
   * A thrown request is HTTP 0 plus an error line (kill switch still stops).
   */
  private async probeItemLevel(): Promise<void> {
    const itemId = this.itemProbeId;
    if (itemId === null) return;
    const url = buildClassicItemUrl(this.deps.region, itemId);
    const res = await this.requestRaw(url).catch((e: unknown) =>
      recordProbeFailure(this.report, `item/${itemId}`, e),
    );
    const itemLevel = res?.status === 200 ? itemLevelOf(res.body) : null;
    const httpStatus = res?.status ?? 0;
    this.report.itemLevelProbe = { itemId, httpStatus, itemLevel };
  }
}
