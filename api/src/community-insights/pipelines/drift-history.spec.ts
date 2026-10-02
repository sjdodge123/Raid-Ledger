import type {
  CommunityRadarResponseDto,
  TasteDriftPointDto,
  TasteProfilePoolAxis,
} from '@raid-ledger/contract';
import { buildSnapshotFixture } from '../__fixtures__/snapshot-fixture';
import { KeyInsightsService } from '../key-insights.service';
import { stitchDriftForInsights, type DriftSourceRow } from './drift-history';

function radar(
  snapshotDate: string,
  axis: TasteProfilePoolAxis,
  meanScore: number,
): CommunityRadarResponseDto {
  return {
    snapshotDate,
    axes: [{ axis, meanScore }],
    archetypes: [],
    driftSeries: [{ weekStart: snapshotDate, axis, meanScore }],
    dominantArchetype: null,
  };
}

function priorRow(snapshotDate: string, meanScore: number): DriftSourceRow {
  return {
    snapshotDate,
    radarPayload: radar(snapshotDate, 'co_op', meanScore),
  };
}

function points(series: TasteDriftPointDto[]): Array<[string, number]> {
  return series.map((p) => [p.weekStart, p.meanScore]);
}

describe('stitchDriftForInsights', () => {
  it('lets the current snapshot win its own ISO week over a same-week prior row', () => {
    // 2026-04-29 (Wed) and 2026-04-27 (Mon) share the week of 2026-04-27.
    const current = radar('2026-04-29', 'co_op', 0.4);
    const prior = [priorRow('2026-04-27', 0.9), priorRow('2026-04-22', 0.2)];

    const stitched = stitchDriftForInsights(prior, current, '2026-04-29');

    expect(points(stitched.driftSeries)).toEqual([
      ['2026-04-20', 0.2],
      ['2026-04-27', 0.4],
    ]);
  });

  it('caps the stitched series at 8 ISO weeks ending with the current week', () => {
    const mondays = [
      '2026-05-04',
      '2026-04-27',
      '2026-04-20',
      '2026-04-13',
      '2026-04-06',
      '2026-03-30',
      '2026-03-23',
      '2026-03-16',
      '2026-03-09',
    ];
    const current = radar('2026-05-13', 'co_op', 0.5);

    const stitched = stitchDriftForInsights(
      mondays.map((d) => priorRow(d, 0.5)),
      current,
      '2026-05-13',
    );

    const weeks = stitched.driftSeries.map((p) => p.weekStart);
    expect(weeks).toHaveLength(8);
    expect(weeks[0]).toBe('2026-03-23');
    expect(weeks[7]).toBe('2026-05-11');
  });

  it('leaves the current radar payload single-week (it is what gets stored)', () => {
    const current = radar('2026-04-29', 'co_op', 0.4);

    stitchDriftForInsights(
      [priorRow('2026-04-22', 0.2)],
      current,
      '2026-04-29',
    );

    expect(current.driftSeries).toEqual([
      { weekStart: '2026-04-29', axis: 'co_op', meanScore: 0.4 },
    ]);
  });
});

describe('stitchDriftForInsights → KeyInsightsService', () => {
  it('gives KeyInsightsService a prior week, so a >5% top-axis move emits genre-shift', () => {
    const fixture = buildSnapshotFixture('2026-04-29');
    const current = radar('2026-04-29', 'co_op', 0.4);
    const input = { ...fixture, radar: current };
    const service = new KeyInsightsService();
    const kinds = (r: CommunityRadarResponseDto) =>
      service.generateInsights({ ...input, radar: r }).map((i) => i.kind);

    // Single-week radar (what the refresh used to pass): nothing to compare.
    expect(kinds(current)).not.toContain('genre-shift');

    const stitched = stitchDriftForInsights(
      [priorRow('2026-04-22', 0.5)],
      current,
      '2026-04-29',
    );
    const shift = service
      .generateInsights({ ...input, radar: stitched })
      .find((i) => i.kind === 'genre-shift');
    expect(shift).toMatchObject({
      kind: 'genre-shift',
      axis: 'co_op',
      deltaPct: -20,
    });
  });
});
