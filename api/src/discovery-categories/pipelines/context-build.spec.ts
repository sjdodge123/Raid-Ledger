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
    expect(seasonalHintsFor(new Date('2026-07-04T00:00:00Z'))).toEqual(
      expect.arrayContaining(['summer']),
    );
  });

  it('is empty when a date yields no window (never actually empty, sanity)', () => {
    const hints = seasonalHintsFor(new Date('2026-04-10T00:00:00Z'));
    expect(hints.length).toBeGreaterThan(0);
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
