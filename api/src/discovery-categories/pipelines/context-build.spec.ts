import { buildGenerationContext, seasonalHintsFor } from './context-build';

describe('seasonalHintsFor', () => {
  it('surfaces Halloween hints in late October', () => {
    expect(seasonalHintsFor(new Date('2026-10-20T00:00:00Z'))).toEqual(
      expect.arrayContaining(['Halloween (mid-to-late October)']),
    );
  });

  it('covers winter holidays in December', () => {
    expect(seasonalHintsFor(new Date('2026-12-15T00:00:00Z'))).toEqual(
      expect.arrayContaining(['winter holidays (December)']),
    );
  });

  it('covers summer during July', () => {
    const hints = seasonalHintsFor(new Date('2026-07-04T00:00:00Z'));
    expect(hints.some((h) => /summer/i.test(h))).toBe(true);
  });

  it('is empty when a date yields no window (never actually empty, sanity)', () => {
    const hints = seasonalHintsFor(new Date('2026-04-10T00:00:00Z'));
    expect(hints.length).toBeGreaterThan(0);
  });

  // ROK-1127 A4: one case per calendar branch in `seasonalHintsFor` so a
  // deleted or re-worded hint line fails here instead of silently shipping.
  const MONTH_BRANCHES: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['2026-01-03', ['New Year / early January, fresh starts']],
    ['2026-02-03', ['mid-winter, indoor gaming peak']],
    [
      '2026-02-14',
      ["Valentine's / couples play", 'mid-winter, indoor gaming peak'],
    ],
    ['2026-03-10', ['early spring, longer days returning']],
    ['2026-04-05', ['mid-spring, Easter window']],
    ['2026-05-12', ['late spring, outdoor-vs-indoor balance']],
    ['2026-06-02', ['early summer, long evenings']],
    ['2026-06-20', ['early summer, long evenings', 'Steam Summer Sale window']],
    ['2026-07-10', ['peak summer / Steam Summer Sale']],
    ['2026-08-18', ['late summer, vacation gaming']],
    ['2026-09-09', ['back-to-school / early autumn']],
    ['2026-10-05', ['early autumn, cozy weather']],
    ['2026-10-31', ['Halloween (mid-to-late October)']],
    ['2026-11-03', ['post-Halloween / early November']],
    ['2026-11-17', ['Steam Autumn Sale window']],
    ['2026-11-25', ['Steam Autumn Sale window', 'Thanksgiving week']],
    ['2026-12-02', ['winter holidays (December)']],
    ['2026-12-20', ['winter holidays (December)', 'Steam Winter Sale window']],
  ];

  it.each(MONTH_BRANCHES)('emits the %s seasonal hints', (iso, expected) => {
    const hints = seasonalHintsFor(new Date(`${iso}T00:00:00Z`));
    expect(hints).toEqual(expect.arrayContaining([...expected]));
  });

  it('always anchors on the ISO date and UTC month name', () => {
    expect(seasonalHintsFor(new Date('2026-03-08T23:30:00Z'))[0]).toBe(
      'today is 2026-03-08 (March)',
    );
  });

  it('withholds day-gated hints before their window opens', () => {
    const earlyFeb = seasonalHintsFor(new Date('2026-02-03T00:00:00Z'));
    expect(earlyFeb).not.toContain("Valentine's / couples play");

    const earlyOct = seasonalHintsFor(new Date('2026-10-05T00:00:00Z'));
    expect(earlyOct).not.toContain('Halloween (mid-to-late October)');

    const midNov = seasonalHintsFor(new Date('2026-11-10T00:00:00Z'));
    expect(midNov).not.toContain('post-Halloween / early November');
    expect(midNov).not.toContain('Steam Autumn Sale window');
    expect(midNov).not.toContain('Thanksgiving week');

    const earlyJune = seasonalHintsFor(new Date('2026-06-02T00:00:00Z'));
    expect(earlyJune).not.toContain('Steam Summer Sale window');
  });
});

describe('buildGenerationContext', () => {
  it('passes loaded data through and attaches seasonal hints', () => {
    const now = new Date('2026-10-25T00:00:00Z');
    const out = buildGenerationContext(
      {
        centroid: [1, 2, 3, 4, 5, 6, 7],
        topPlayed: [{ name: 'A', totalSeconds: 100 }],
        trending: [{ name: 'B', deltaPct: 50 }],
        existingCategories: [{ name: 'Old', categoryType: 'trend' }],
      },
      now,
      4,
    );
    expect(out.centroid).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(out.topPlayed).toEqual([{ name: 'A', totalSeconds: 100 }]);
    expect(out.trending).toEqual([{ name: 'B', deltaPct: 50 }]);
    expect(out.existingCategories).toEqual([
      { name: 'Old', categoryType: 'trend' },
    ]);
    expect(out.seasonalHints).toEqual(
      expect.arrayContaining(['Halloween (mid-to-late October)']),
    );
    expect(out.maxProposals).toBe(4);
  });
});
