/**
 * ROK-1842 — overlapping/duplicate absences merge before the composite view
 * expands them, so N rows over the same days cost one span.
 */
import {
  mergeAbsenceSpans,
  mergeWithinWindow,
} from './game-time-absence-merge.helpers';

const WEEK = { firstDate: '2026-04-05', lastDate: '2026-04-11' };

describe('mergeAbsenceSpans (ROK-1842)', () => {
  it('collapses 100 identical spans to one', () => {
    const spans = Array.from({ length: 100 }, () => ({
      startDate: '2026-04-06',
      endDate: '2026-04-08',
    }));
    expect(mergeAbsenceSpans(spans)).toEqual([
      { startDate: '2026-04-06', endDate: '2026-04-08' },
    ]);
  });

  it('joins overlapping and adjacent spans, keeps gaps apart', () => {
    expect(
      mergeAbsenceSpans([
        { startDate: '2026-04-10', endDate: '2026-04-12' },
        { startDate: '2026-04-01', endDate: '2026-04-03' },
        { startDate: '2026-04-04', endDate: '2026-04-05' },
        { startDate: '2026-04-02', endDate: '2026-04-02' },
      ]),
    ).toEqual([
      { startDate: '2026-04-01', endDate: '2026-04-05' },
      { startDate: '2026-04-10', endDate: '2026-04-12' },
    ]);
  });

  it('does not mutate its input', () => {
    const spans = [
      { startDate: '2026-04-01', endDate: '2026-04-03' },
      { startDate: '2026-04-02', endDate: '2026-04-09' },
    ];
    mergeAbsenceSpans(spans);
    expect(spans[0]).toEqual({
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    });
  });
});

describe('mergeWithinWindow (ROK-1842)', () => {
  it('clips to the week, drops outside spans, merges the rest', () => {
    expect(
      mergeWithinWindow(
        [
          { startDate: '0001-01-01', endDate: '9999-12-31' },
          { startDate: '2026-04-06', endDate: '2026-04-07' },
          { startDate: '2025-01-01', endDate: '2025-01-02' },
        ],
        WEEK,
      ),
    ).toEqual([{ startDate: '2026-04-05', endDate: '2026-04-11' }]);
  });
});
