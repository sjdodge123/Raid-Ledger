/** ROK-1926 — the quest evidence that feeds the readiness freshness footer. */
import { questEvidence } from './event-raid-readiness.evidence';
import type { ManualProgressRow } from './quest-progress-addon.helpers';

const CHAR = '11111111-1111-4111-8111-111111111111';
const OLD = new Date('2026-10-30T12:00:00.000Z');
const NEW = new Date('2026-11-01T12:00:00.000Z');

const row = (
  perQuestIds: number[],
  source: 'addon' | 'blizzard' | null = null,
) => ({
  userId: 7,
  characterId: CHAR,
  name: 'Aldric',
  perQuest: perQuestIds.map((questId) => ({
    questId,
    state: source === 'addon' ? ('have' as const) : ('missing' as const),
    prereqsMet: null,
    source,
  })),
});
const snap = (
  source: 'addon' | 'blizzard',
  capturedAt: Date,
  inProgressAsOf: Date | null = source === 'addon' ? capturedAt : null,
) => ({ source, capturedAt, inProgressAsOf });

const manual = (userId: number, questId: number): ManualProgressRow => ({
  id: questId,
  userId,
  questId,
  pickedUp: true,
  completed: false,
  updatedAt: NEW,
});

describe('questEvidence', () => {
  it('takes the effective quest data and the user’s manual rows on counted quests', () => {
    const snaps = new Map([[CHAR, snap('addon', OLD)]]);
    const rows = [manual(7, 1), manual(7, 99), manual(8, 1)];
    expect(questEvidence(row([1, 2]), snaps, rows)).toEqual([
      { source: 'addon', asOf: OLD },
      { source: 'manual', asOf: NEW },
    ]);
  });

  it('dates an Armory-sourced list as blizzard evidence (ROK-2109)', () => {
    const snaps = new Map([[CHAR, snap('blizzard', OLD)]]);
    expect(questEvidence(row([1]), snaps, [])).toEqual([
      { source: 'blizzard', asOf: OLD },
    ]);
  });

  it('also dates the older addon log when it fed a counted quest under an Armory win (ROK-2109 D4)', () => {
    const snaps = new Map([[CHAR, snap('blizzard', NEW, OLD)]]);
    const out = questEvidence(row([1], 'addon'), snaps, []);
    expect(out).toEqual([
      { source: 'blizzard', asOf: NEW },
      { source: 'addon', asOf: OLD },
    ]);
    const times = out.flatMap((e) => (e.asOf ? [e.asOf.getTime()] : []));
    expect(new Date(Math.min(...times))).toEqual(OLD);
  });

  it('leaves the addon log out when no counted quest read it', () => {
    const snaps = new Map([[CHAR, snap('blizzard', NEW, OLD)]]);
    expect(questEvidence(row([1], 'blizzard'), snaps, [])).toEqual([
      { source: 'blizzard', asOf: NEW },
    ]);
  });

  it('skips a character without quest data and a row with no usable quest', () => {
    const snaps = new Map<string, ReturnType<typeof snap>>();
    expect(questEvidence(row([1]), snaps, [])).toEqual([]);
    expect(questEvidence(row([]), snaps, [manual(7, 1)])).toEqual([]);
    expect(questEvidence(undefined, snaps, [])).toEqual([]);
  });
});
