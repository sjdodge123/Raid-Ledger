/**
 * ROK-1748 L5b-2: pure builders between the Forever event query and the
 * quest-progress read service. No DB access.
 */
import type {
  EventQuestPrereqsResponse,
  QuestCoverageEntry,
  QuestProgressDto,
  QuestProgressSource,
} from '@raid-ledger/contract';
import { readQuestsSlice } from './character-quests.service';
import { walkChainInMemory } from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import type { CharSnapshot } from './forever-char-snapshot.query';
import { resolveQuestInstanceIds } from './forever-instance-aliases';
import {
  buildPrereqState,
  countNeeded,
  deriveAddonProgress,
  doneLookupFromRows,
  mergeProgress,
  type AddonProgressRow,
  type AddonQuestSnapshot,
  type ManualProgressRow,
} from './quest-progress-addon.helpers';

/** An active signup with a character (D8). */
export interface EventSignupChar {
  userId: number;
  username: string;
  characterId: string;
}

/** A signed-up character whose snapshot carries a `quests` slice. */
export interface ForeverMember extends EventSignupChar {
  snapshot: AddonQuestSnapshot;
}

/** Everything the read paths need for one Forever event (D7). */
export interface ForeverEventProgress {
  eventQuests: DungeonQuestDto[];
  lookup: Map<number, DungeonQuestDto>;
  knownIds: Set<number>;
  members: ForeverMember[];
}

/** A manual row joined with its username (event-scoped). */
export type ManualRowWithName = ManualProgressRow & { username: string };

/**
 * One stored content-instance entry's numeric id. Mirrors the web parsers
 * (`quest-prep-panel.tsx` / `boss-loot-panel.tsx`): a numeric `id`, a numeric
 * string `id`, or the legacy `instanceId` key.
 */
function contentInstanceId(entry: unknown): number | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const { id, instanceId } = entry as { id?: unknown; instanceId?: unknown };
  const raw = id ?? instanceId;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Instance ids from `events.content_instances`, aliases resolved. */
export function contentInstanceIds(content: unknown): number[] {
  if (!Array.isArray(content)) return [];
  const ids = content
    .map(contentInstanceId)
    .filter((id): id is number => id !== undefined);
  return [...new Set(ids.flatMap((id) => resolveQuestInstanceIds(id)))];
}

/** Event quests (instance match) and the bounded known set: them + chains. */
export function selectEventQuests(
  known: DungeonQuestDto[],
  instanceIds: number[],
): Pick<ForeverEventProgress, 'eventQuests' | 'lookup' | 'knownIds'> {
  const lookup = new Map(known.map((q) => [q.questId, q]));
  const wanted = new Set(instanceIds);
  const eventQuests = known.filter(
    (q) => q.dungeonInstanceId !== null && wanted.has(q.dungeonInstanceId),
  );
  const knownIds = new Set<number>();
  for (const q of eventQuests) {
    for (const step of walkChainInMemory(q, lookup)) knownIds.add(step.questId);
  }
  return { eventQuests, lookup, knownIds };
}

/** Keep signups whose snapshot has a valid `quests` slice (schema ≥2). */
export function buildMembers(
  signups: EventSignupChar[],
  snapshots: Map<string, CharSnapshot>,
): ForeverMember[] {
  return signups.flatMap((s) => {
    const snap = snapshots.get(s.characterId);
    const quests = snap ? readQuestsSlice(snap.data) : undefined;
    if (!snap || !quests) return [];
    const capturedAt = snap.capturedAt.toISOString();
    return [{ ...s, snapshot: { quests, capturedAt } }];
  });
}

/** Addon rows for every member, or only `userId`'s (D6/D7). */
export function addonRowsFor(
  progress: ForeverEventProgress,
  userId?: number,
): AddonProgressRow[] {
  return progress.members
    .filter((m) => userId === undefined || m.userId === userId)
    .flatMap((m) =>
      deriveAddonProgress(
        m.snapshot,
        progress.knownIds,
        m.userId,
        m.characterId,
      ),
    );
}

/** Merged GET progress rows for a Forever event (D5/D9). */
export function toProgressDtos(
  eventId: number,
  manual: ManualRowWithName[],
  progress: ForeverEventProgress,
): QuestProgressDto[] {
  const names = new Map<number, string>([
    ...progress.members.map((m): [number, string] => [m.userId, m.username]),
    ...manual.map((r): [number, string] => [r.userId, r.username]),
  ]);
  return mergeProgress(manual, addonRowsFor(progress)).map((r) => ({
    ...r,
    eventId,
    username: names.get(r.userId) ?? 'Unknown',
  }));
}

/** Coverage source row; `source` is absent on Classic rows (AC6). */
interface CoverageRow {
  questId: number;
  userId: number;
  username: string;
  pickedUp: boolean;
  source?: QuestProgressSource | undefined;
  asOf?: string | undefined;
}

/** Group picked-up rows by quest; `source`/`asOf` carried when present. */
export function groupCoverage(rows: CoverageRow[]): QuestCoverageEntry[] {
  const map = new Map<number, QuestCoverageEntry['coveredBy']>();
  for (const r of rows.filter((row) => row.pickedUp)) {
    const list = map.get(r.questId) ?? [];
    const extra = r.source ? { source: r.source, asOf: r.asOf } : {};
    list.push({ userId: r.userId, username: r.username, ...extra });
    map.set(r.questId, list);
  }
  return [...map].map(([questId, coveredBy]) => ({ questId, coveredBy }));
}

/** The viewer's chain state over the event's quests (D11/D12). */
export function buildViewerPrereqs(
  progress: ForeverEventProgress,
  member: ForeverMember,
  viewerManual: ManualProgressRow[],
): NonNullable<EventQuestPrereqsResponse> {
  const rows = mergeProgress(
    viewerManual,
    addonRowsFor(progress, member.userId),
  );
  const quests = buildPrereqState(
    progress.eventQuests,
    progress.lookup,
    doneLookupFromRows(rows),
  );
  return {
    characterId: member.characterId,
    asOf: member.snapshot.capturedAt,
    quests,
    neededTotal: countNeeded(quests),
  };
}
