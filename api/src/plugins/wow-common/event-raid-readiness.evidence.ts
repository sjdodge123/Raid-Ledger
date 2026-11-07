/**
 * ROK-1926 — the dated evidence behind one signup's quest check, so the
 * "as of" footer (the OLDEST fact that fed any cell) covers quests too: the
 * character's effective quest data (addon snapshot or Armory list, ROK-2109),
 * the addon log when an Armory-won check read it, and the user's manual rows
 * on the quests the check counted.
 */
import type { EventQuestReadinessDto } from '@raid-ledger/contract';
import type { ReadinessEvidence } from './event-raid-readiness.helpers';
import type { ManualProgressRow } from './quest-progress-addon.helpers';

type QuestRow = EventQuestReadinessDto['signups'][number];
/** An `EffectiveQuests` satisfies it (ROK-2109: addon or Armory). */
type QuestSnapshot = {
  source: 'addon' | 'blizzard';
  capturedAt: Date;
  /** The addon log's date; it can be older than an Armory-won list (D4). */
  inProgressAsOf: Date | null;
};

/** [] when the signup has no quest row or no usable quest. */
export function questEvidence(
  row: QuestRow | undefined,
  snapshots: ReadonlyMap<string, QuestSnapshot>,
  manual: readonly ManualProgressRow[],
): ReadinessEvidence[] {
  if (!row || row.perQuest.length === 0) return [];
  const out: ReadinessEvidence[] = [];
  const snap = row.characterId ? snapshots.get(row.characterId) : undefined;
  if (snap) {
    out.push({ source: snap.source, asOf: snap.capturedAt });
    // An Armory win still reads `have` from the addon log: date it too.
    const logFed = row.perQuest.some((q) => q.source === 'addon');
    if (snap.source === 'blizzard' && snap.inProgressAsOf && logFed) {
      out.push({ source: 'addon', asOf: snap.inProgressAsOf });
    }
  }
  const ids = new Set(row.perQuest.map((q) => q.questId));
  for (const m of manual) {
    if (m.userId === row.userId && ids.has(m.questId)) {
      out.push({ source: 'manual', asOf: m.updatedAt });
    }
  }
  return out;
}
