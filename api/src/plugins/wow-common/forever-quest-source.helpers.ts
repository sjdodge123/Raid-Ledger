/**
 * ROK-2109 (D4): the effective quest data of one WoW: Forever character, from
 * the LedgerLink `char` snapshot and/or the Armory `quests/completed` sync.
 *
 * - completed list (+ truncation flag, capture time, source): the NEWER of
 *   the two, through the ROK-1910 resolver with the 24h Blizzard override off
 *   (ruling 2026-10-09: newest snapshot wins; a tie keeps the addon).
 * - in-progress log: always the addon's — Blizzard serves no quest log, so a
 *   newer Armory sync must not blank it.
 *
 * Pure: no I/O, no clock reads (the caller passes `now`).
 */
import { AddonQuestsSchema } from '@raid-ledger/contract';
import { ArmoryQuestsSchema } from './blizzard-quests.helpers';
import type { ForeverQuestSnapshotInput } from './character-quests.helpers';
import { resolveField } from './facts/fact-precedence';
import type { Fact } from './facts/wow-fact.types';

/** The quests slice every consumer reads (addon log entries included). */
export type QuestsSlice = NonNullable<ForeverQuestSnapshotInput['quests']>;

/** Which source supplied the completed list. */
export type QuestSource = 'addon' | 'blizzard';

/** A character's effective quest data. */
export interface EffectiveQuests {
  quests: QuestsSlice;
  /** Capture time of the winning completed list. */
  capturedAt: Date;
  source: QuestSource;
  /** Capture time of the in-progress log; null without an addon snapshot. */
  inProgressAsOf: Date | null;
}

/** The addon side: a snapshot's `data` + capture time. */
export interface AddonQuestInput {
  data: unknown;
  capturedAt: Date;
}

/**
 * Read `data.quests` (snapshot schema 2) through the ROK-1742 wire schema.
 * Schema-1 rows (no `quests`) and malformed slices return `undefined`.
 */
export function readQuestsSlice(data: unknown): QuestsSlice | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const parsed = AddonQuestsSchema.safeParse(
    (data as { quests?: unknown }).quests,
  );
  return parsed.success ? (parsed.data satisfies QuestsSlice) : undefined;
}

type Completed = Pick<QuestsSlice, 'completed' | 'completedTruncated'>;

/** The Armory column as a fact; malformed jsonb → absent (AC5). */
function armoryFact(raw: unknown): Fact<Completed> | null {
  const parsed = ArmoryQuestsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const { completed, completedTruncated, fetchedAt } = parsed.data;
  const value: Completed = completedTruncated
    ? { completed, completedTruncated }
    : { completed };
  return { value, source: 'blizzard', asOf: new Date(fetchedAt) };
}

/**
 * Combine the two sources (D4).
 * @returns null when neither source has usable quest data.
 */
export function effectiveQuests(
  addon: AddonQuestInput | null,
  armoryRaw: unknown,
  now: Date,
): EffectiveQuests | null {
  const slice = addon ? readQuestsSlice(addon.data) : undefined;
  const addonFact: Fact<Completed> | null =
    addon && slice
      ? { value: slice, source: 'addon', asOf: addon.capturedAt }
      : null;
  const armory = armoryFact(armoryRaw);
  // Addon first: the resolver keeps the earlier candidate on a tie.
  const candidates = [addonFact, armory].filter(
    (f): f is Fact<Completed> => f !== null,
  );
  const winner = resolveField('quests', candidates, now, false);
  if (!winner || !winner.asOf) return null;
  const { completed, completedTruncated } = winner.value;
  return {
    quests: {
      completed,
      ...(completedTruncated ? { completedTruncated } : {}),
      inProgress: slice?.inProgress ?? [],
    },
    capturedAt: winner.asOf,
    source: winner.source === 'blizzard' ? 'blizzard' : 'addon',
    inProgressAsOf: slice && addon ? addon.capturedAt : null,
  };
}
