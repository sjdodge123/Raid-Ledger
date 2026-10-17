import { Injectable } from '@nestjs/common';
import type { ChurnRiskEntryDto } from '@raid-ledger/contract';

export interface ChurnInputRow {
  userId: number;
  username: string;
  avatar: string | null;
  /** Weekly totalHours rows sorted oldest → newest. */
  weeks: Array<{ weekStart: string; totalHours: number }>;
}

export interface ChurnDetectionSettings {
  thresholdPct: number;
  baselineWeeks: number;
  recentWeeks: number;
}

export interface ChurnDetectionResult {
  thresholdPct: number;
  baselineWeeks: number;
  recentWeeks: number;
  notEnoughHistory: boolean;
  atRisk: ChurnRiskEntryDto[];
  candidates: ChurnRiskEntryDto[];
}

/**
 * Detects players at risk of churn using a baseline-vs-recent weekly
 * intensity comparison. A user qualifies when their drop meets the
 * threshold; users with too little history are excluded but surface via
 * `notEnoughHistory`.
 */
@Injectable()
export class ChurnDetectionService {
  findAtRiskPlayers(
    rows: ChurnInputRow[],
    settings: ChurnDetectionSettings,
  ): ChurnDetectionResult {
    const { thresholdPct, baselineWeeks, recentWeeks } = settings;
    const candidates: ChurnRiskEntryDto[] = [];
    let notEnoughHistory = false;

    for (const row of rows) {
      const required = baselineWeeks + recentWeeks;
      if (row.weeks.length < required) {
        notEnoughHistory = true;
        continue;
      }
      const candidate = computeCandidate(row, baselineWeeks, recentWeeks);
      if (candidate) candidates.push(candidate);
    }

    const atRisk = candidates.filter((c) => c.dropPct >= thresholdPct);
    atRisk.sort((a, b) => b.dropPct - a.dropPct);
    candidates.sort((a, b) => b.dropPct - a.dropPct);

    return {
      thresholdPct,
      baselineWeeks,
      recentWeeks,
      notEnoughHistory,
      atRisk,
      candidates,
    };
  }
}

function computeCandidate(
  row: ChurnInputRow,
  baselineWeeks: number,
  recentWeeks: number,
): ChurnRiskEntryDto | null {
  const weeks = row.weeks;
  const recent = weeks.slice(-recentWeeks);
  const baseline = weeks.slice(-(baselineWeeks + recentWeeks), -recentWeeks);
  const baselineAvg = avg(baseline.map((w) => w.totalHours));
  const recentAvg = avg(recent.map((w) => w.totalHours));
  if (baselineAvg <= 0) return null;
  const dropPct = ((baselineAvg - recentAvg) / baselineAvg) * 100;
  return {
    userId: row.userId,
    username: row.username,
    avatar: row.avatar,
    baselineHours: round(baselineAvg),
    recentHours: round(recentAvg),
    dropPct: round(dropPct),
  };
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function round(x: number): number {
  return Math.round(x * 100) / 100;
}
