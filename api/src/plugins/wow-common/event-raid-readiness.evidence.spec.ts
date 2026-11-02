/** ROK-1926 — the quest evidence that feeds the readiness freshness footer. */
import { questEvidence } from './event-raid-readiness.evidence';
import type { ManualProgressRow } from './quest-progress-addon.helpers';

const CHAR = '11111111-1111-4111-8111-111111111111';
const OLD = new Date('2026-10-30T12:00:00.000Z');
const NEW = new Date('2026-11-01T12:00:00.000Z');
const quests = { completed: [], inProgress: [] };

const row = (perQuestIds: number[]) => ({
  userId: 7,
  characterId: CHAR,
  name: 'Aldric',
  perQuest: perQuestIds.map((questId) => ({
    questId,
    state: 'missing' as const,
    prereqsMet: null,
    source: null,
  })),
});

const manual = (userId: number, questId: number): ManualProgressRow => ({
  id: questId,
  userId,
  questId,
  pickedUp: true,
  completed: false,
  updatedAt: NEW,
});

describe('questEvidence', () => {
  it('takes the parsed quests snapshot and the user’s manual rows on counted quests', () => {
    const snaps = new Map([[CHAR, { data: { quests }, capturedAt: OLD }]]);
    const rows = [manual(7, 1), manual(7, 99), manual(8, 1)];
    expect(questEvidence(row([1, 2]), snaps, rows)).toEqual([
      { source: 'addon', asOf: OLD },
      { source: 'manual', asOf: NEW },
    ]);
  });

  it('skips a snapshot without a quests slice and a row with no usable quest', () => {
    const snaps = new Map([[CHAR, { data: {}, capturedAt: OLD }]]);
    expect(questEvidence(row([1]), snaps, [])).toEqual([]);
    expect(questEvidence(row([]), snaps, [manual(7, 1)])).toEqual([]);
    expect(questEvidence(undefined, snaps, [])).toEqual([]);
  });
});
