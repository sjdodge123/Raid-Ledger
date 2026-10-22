/**
 * ROK-1911 (H9 of ROK-1905): pure builder for the roster-wide quest readiness
 * matrix. Reuses ROK-1748's merge (D5: a manual row wins), truncation cutoff
 * and chain walk, applied per signup. No DB access.
 */
import type {
  EventQuestReadinessDto,
  QuestReadinessState,
} from '@raid-ledger/contract';
import { readQuestsSlice } from './character-quests.service';
import { walkChainInMemory } from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import type { ForeverEventProgress } from './event-forever-progress.helpers';
import type { CharSnapshot } from './forever-char-snapshot.query';
import {
  deriveAddonProgress,
  doneLookupFromRows,
  isQuestUsableBy,
  mergeProgress,
  truncationCutoff,
  type ManualProgressRow,
  type MergedProgressRow,
  type QuestDoneFn,
} from './quest-progress-addon.helpers';

/** Contract caps (`wow-event-quest-readiness.schema.ts`). */
export const MAX_READINESS_QUESTS = 200;
export const MAX_READINESS_SIGNUPS = 100;

type SignupRow = EventQuestReadinessDto['signups'][number];
type PerQuest = SignupRow['perQuest'][number];

/** An active signup, with or without a character. */
export interface ReadinessSignup {
  userId: number;
  username: string;
  characterId: string | null;
  characterName: string | null;
  charClass: string | null;
  charRace: string | null;
}

/** Everything the builder needs, loaded in batched queries. */
export interface ReadinessInput {
  quests: Pick<ForeverEventProgress, 'eventQuests' | 'lookup' | 'knownIds'>;
  signups: ReadinessSignup[];
  snapshots: Map<string, CharSnapshot>;
  manual: ManualProgressRow[];
}

/** One signup's merged rows + a done lookup (unknown without a snapshot). */
interface SignupProgress {
  byQuest: Map<number, MergedProgressRow>;
  doneFn: QuestDoneFn;
}

function signupProgress(
  s: ReadinessSignup,
  input: ReadinessInput,
  manual: ManualProgressRow[],
): SignupProgress {
  const snap = s.characterId ? input.snapshots.get(s.characterId) : undefined;
  const quests = snap ? readQuestsSlice(snap.data) : undefined;
  const addon =
    snap && quests && s.characterId
      ? deriveAddonProgress(
          { quests, capturedAt: snap.capturedAt.toISOString() },
          input.quests.knownIds,
          s.userId,
          s.characterId,
        )
      : [];
  const rows = mergeProgress(manual, addon);
  const base = doneLookupFromRows(rows, quests && truncationCutoff(quests));
  // Without a quests snapshot, a quest with no manual row is not knowable.
  const doneFn: QuestDoneFn = (id) => {
    const st = base(id);
    return quests || st.source ? st : { ...st, unknown: true };
  };
  return { byQuest: new Map(rows.map((r) => [r.questId, r])), doneFn };
}

function stateOf(
  row: MergedProgressRow | undefined,
  unknown: boolean,
): QuestReadinessState {
  if (row?.completed) return 'done';
  if (row?.pickedUp) return 'have';
  return !row && unknown ? 'unknown' : 'missing';
}

/** Every pre-req step done → true; any unknowable step (or no chain position) → null. */
function prereqsMet(
  quest: DungeonQuestDto,
  lookup: Map<number, DungeonQuestDto>,
  doneFn: QuestDoneFn,
): boolean | null {
  const chain = walkChainInMemory(quest, lookup);
  const idx = chain.findIndex((q) => q.questId === quest.questId);
  // A quest missing from its own chain has an unknowable pre-req set.
  if (idx < 0) return null;
  const states = chain.slice(0, idx).map((q) => doneFn(q.questId));
  if (states.some((st) => !st.done && st.unknown)) return null;
  return states.every((st) => st.done);
}

function perQuestFor(
  q: DungeonQuestDto,
  p: SignupProgress,
  lookup: Map<number, DungeonQuestDto>,
): PerQuest {
  const row = p.byQuest.get(q.questId);
  return {
    questId: q.questId,
    state: stateOf(row, p.doneFn(q.questId).unknown),
    prereqsMet: prereqsMet(q, lookup, p.doneFn),
    source: row?.source ?? null,
  };
}

function signupRow(
  s: ReadinessSignup,
  quests: DungeonQuestDto[],
  input: ReadinessInput,
  manual: ManualProgressRow[],
): SignupRow {
  const progress = signupProgress(s, input, manual);
  const usable = quests.filter((q) =>
    isQuestUsableBy(q, s.charClass, s.charRace),
  );
  return {
    userId: s.userId,
    // The character the signup uses for this event (null = no character).
    characterId: s.characterId,
    name: (s.characterName ?? s.username).slice(0, 64),
    perQuest: usable.map((q) => perQuestFor(q, progress, input.quests.lookup)),
  };
}

function groupManual(
  rows: ManualProgressRow[],
): Map<number, ManualProgressRow[]> {
  const map = new Map<number, ManualProgressRow[]>();
  for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r]);
  return map;
}

/**
 * Build the roster-wide readiness matrix: per signup × usable event quest,
 * done/have/missing/unknown, `prereqsMet` and the winning `source`.
 */
export function buildQuestReadiness(
  input: ReadinessInput,
): EventQuestReadinessDto {
  const quests = input.quests.eventQuests
    .filter((q) => q.dungeonInstanceId !== null)
    // Capped at 100 signups / 200 quests; a `truncated` flag is a contract follow-up.
    .slice(0, MAX_READINESS_QUESTS);
  const manual = groupManual(input.manual);
  return {
    quests: quests.map((q) => ({
      questId: q.questId,
      title: q.name.slice(0, 200),
      instanceId: q.dungeonInstanceId ?? 0,
    })),
    signups: input.signups
      .slice(0, MAX_READINESS_SIGNUPS)
      .map((s) => signupRow(s, quests, input, manual.get(s.userId) ?? [])),
  };
}
