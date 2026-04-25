import {
  ChurnDetectionService,
  type ChurnInputRow,
} from './churn-detection.service';

describe('ChurnDetectionService', () => {
  const service = new ChurnDetectionService();

  const settings = { thresholdPct: 70, baselineWeeks: 12, recentWeeks: 4 };

  function buildRow(userId: number, hoursSeries: number[]): ChurnInputRow {
    return {
      userId,
      username: `user${userId}`,
      avatar: null,
      weeks: hoursSeries.map((h, i) => ({
        weekStart: `2026-01-${String(i + 1).padStart(2, '0')}`,
        totalHours: h,
      })),
    };
  }

  it('flags players whose recent average has dropped past the threshold', () => {
    const steady = buildRow(1, Array(16).fill(10));
    const dropping = buildRow(
      2,
      [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1, 1, 1, 1],
    );
    const res = service.findAtRiskPlayers([steady, dropping], settings);
    expect(res.atRisk).toHaveLength(1);
    expect(res.atRisk[0].userId).toBe(2);
    expect(res.atRisk[0].dropPct).toBeGreaterThanOrEqual(70);
    expect(res.candidates).toHaveLength(2);
  });

  it('excludes players with insufficient history and flags notEnoughHistory', () => {
    const short = buildRow(3, [5, 5, 5]);
    const res = service.findAtRiskPlayers([short], settings);
    expect(res.atRisk).toHaveLength(0);
    expect(res.candidates).toHaveLength(0);
    expect(res.notEnoughHistory).toBe(true);
  });

  it('does not flag steady players', () => {
    const steady = buildRow(4, Array(16).fill(5));
    const res = service.findAtRiskPlayers([steady], settings);
    expect(res.atRisk).toHaveLength(0);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0].dropPct).toBeCloseTo(0, 1);
  });

  it('returns candidates sorted by dropPct desc', () => {
    const mid = buildRow(
      5,
      [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5, 5, 5],
    );
    const big = buildRow(
      6,
      [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0, 0],
    );
    const res = service.findAtRiskPlayers([mid, big], settings);
    expect(res.candidates[0].userId).toBe(6);
    expect(res.candidates[1].userId).toBe(5);
  });
});
