/**
 * ROK-1926 — the dated evidence behind one signup's quest check, so the
 * "as of" footer (the OLDEST fact that fed any cell) covers quests too: the
 * character's quests snapshot when it parses (as `buildQuestReadiness` reads
 * it) and the user's manual rows on the quests the check counted.
 */
import type { EventQuestReadinessDto } from '@raid-ledger/contract';
import { readQuestsSlice } from './character-quests.service';
import type { ReadinessEvidence } from './event-raid-readiness.helpers';
import type { ManualProgressRow } from './quest-progress-addon.helpers';

type QuestRow = EventQuestReadinessDto['signups'][number];
/** A `CharSnapshot` satisfies it; only the quests slice is read. */
type QuestSnapshot = { data: unknown; capturedAt: Date };

/** [] when the signup has no quest row or no usable quest. */
export function questEvidence(
  row: QuestRow | undefined,
  snapshots: ReadonlyMap<string, QuestSnapshot>,
  manual: readonly ManualProgressRow[],
): ReadinessEvidence[] {
  if (!row || row.perQuest.length === 0) return [];
  const out: ReadinessEvidence[] = [];
  const snap = row.characterId ? snapshots.get(row.characterId) : undefined;
  if (snap && readQuestsSlice(snap.data)) {
    out.push({ source: 'addon', asOf: snap.capturedAt });
  }
  const ids = new Set(row.perQuest.map((q) => q.questId));
  for (const m of manual) {
    if (m.userId === row.userId && ids.has(m.questId)) {
      out.push({ source: 'manual', asOf: m.updatedAt });
    }
  }
  return out;
}
