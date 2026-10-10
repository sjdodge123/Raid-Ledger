import { FOREVER_SEED_ID_BASE, isForeverSeedId } from './forever-instance-data';
import {
  FOREVER_JOURNAL_ALIASES,
  resolveQuestInstanceIds,
} from './forever-instance-aliases';

const SEED_1 = FOREVER_SEED_ID_BASE + 1;

describe('FOREVER_JOURNAL_ALIASES (ROK-1748 D3/D4)', () => {
  it('maps non-seed journal ids to seed ids only', () => {
    for (const [key, value] of Object.entries(FOREVER_JOURNAL_ALIASES)) {
      expect(isForeverSeedId(Number(key))).toBe(false);
      expect(isForeverSeedId(value)).toBe(true);
    }
  });
});

describe('resolveQuestInstanceIds', () => {
  it('returns a seed id alone (no /100 parent rule)', () => {
    expect(resolveQuestInstanceIds(SEED_1)).toEqual([SEED_1]);
  });

  it('returns an aliased journal id plus its seed id', () => {
    expect(resolveQuestInstanceIds(1301, { 1301: SEED_1 })).toEqual([
      1301,
      SEED_1,
    ]);
  });

  it('keeps the Classic /100 parent rule for synthetic wing ids', () => {
    expect(resolveQuestInstanceIds(31601)).toEqual([31601, 316]);
  });

  it('returns a plain Classic id alone', () => {
    expect(resolveQuestInstanceIds(228)).toEqual([228]);
  });
});
