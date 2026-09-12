import {
  cohortSizeBucket,
  foldFrequencyRows,
  type FrequencyRow,
} from './cohort-frequency-section';

describe('cohortSizeBucket (ROK-1310)', () => {
  it('collapses 6 and 7 into 6+ and leaves 1 unbucketed', () => {
    expect(cohortSizeBucket(7)).toBe('6+');
    expect(cohortSizeBucket(6)).toBe('6+');
    expect(cohortSizeBucket(1)).toBeNull();
    expect(cohortSizeBucket(2)).toBe('2');
    expect(cohortSizeBucket(5)).toBe('5');
  });
});

/**
 * ROK-1310 finding 4: `count` is OCCASIONS (distinct source lineups), not the
 * sum of the four resolution keys. One `voting -> decided` transition writes
 * `decided` + `match`, and via a tiebreaker also `veto_won` — summing them
 * scored a plainly-decided game 2 and a tiebreaker-decided game 3, so
 * tiebreaker games out-ranked genuinely more-played ones.
 */
describe('foldFrequencyRows count semantics (ROK-1310)', () => {
  const row = (over: Partial<FrequencyRow>): FrequencyRow => ({
    cohortSize: 3,
    gameId: 1,
    gameName: 'A',
    gameCoverUrl: null,
    lineups: 1,
    decided: 0,
    match: 0,
    vetoWon: 0,
    vetoLost: 0,
    ...over,
  });

  it('counts one lineup once however many resolution rows it wrote', () => {
    const [bucket] = foldFrequencyRows(
      [row({ lineups: 1, decided: 1, match: 1, vetoWon: 1 })],
      5,
    );

    expect(bucket.entries[0].count).toBe(1);
    expect(bucket.entries[0].breakdown).toEqual({
      decided: 1,
      match: 1,
      vetoWon: 1,
      vetoLost: 0,
    });
  });

  it('ranks a twice-played game above a once-tiebroken one', () => {
    const [bucket] = foldFrequencyRows(
      [
        row({ gameId: 1, gameName: 'Twice played', lineups: 2, decided: 2 }),
        row({
          gameId: 2,
          gameName: 'Tiebroken once',
          lineups: 1,
          decided: 1,
          match: 1,
          vetoWon: 1,
        }),
      ],
      5,
    );

    expect(bucket.entries.map((e) => [e.gameName, e.count])).toEqual([
      ['Twice played', 2],
      ['Tiebroken once', 1],
    ]);
  });
});
