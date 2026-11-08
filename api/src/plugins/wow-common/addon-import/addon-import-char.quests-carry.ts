/**
 * ROK-2125: LedgerLink may omit `data.quests.completed` (additive v1, "no
 * opinion" — the Armory `quests/completed` sync serves the same list). The
 * `char` snapshot row is replaced wholesale on import, so without this step a
 * log-only export would silently drop the completed list stored before it.
 * Pure: no I/O.
 */
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { readQuestsSlice } from '../forever-quest-source.helpers';

/**
 * The snapshot data to write: `incoming` as sent, except that a `quests`
 * slice without `completed` takes the stored row's completed list and
 * truncation flag. An explicit list (empty included) is never touched.
 * @param storedData the `data` jsonb of the stored `char` row, if any
 */
export function carryStoredCompletedQuests(
  incoming: AddonCharSnapshotData,
  storedData: unknown,
): AddonCharSnapshotData {
  const quests = incoming.quests;
  if (!quests || quests.completed !== undefined) return incoming;
  const stored = readQuestsSlice(storedData);
  if (!stored?.completed) return incoming;
  return {
    ...incoming,
    quests: {
      ...quests,
      completed: stored.completed,
      ...(stored.completedTruncated ? { completedTruncated: true } : {}),
    },
  };
}
