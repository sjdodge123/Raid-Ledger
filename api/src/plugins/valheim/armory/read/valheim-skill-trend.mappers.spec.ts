/**
 * ROK-1882 — `toSkillTrend` maths: effective levels, a skill new on the
 * day starts at 0, the |gain| < 0.05 threshold, death-penalty (negative)
 * gains passed through, ≤3 days newest first.
 */
import type { ValheimSkill } from '@raid-ledger/contract';
import {
  effectiveLevel,
  toSkillTrend,
  type SkillTrendDayRow,
} from './valheim-skill-trend.mappers';

const sk = (id: string, level: number, accumulator = 0): ValheimSkill => ({
  id,
  level,
  accumulator,
});

function day(
  playDate: string,
  startSkills: ValheimSkill[],
  endSkills: ValheimSkill[],
): SkillTrendDayRow {
  return { playDate, startSkills, endSkills };
}

describe('effectiveLevel (ROK-1882)', () => {
  it('adds the progress fraction toward the next level', () => {
    // need(10) = 11^1.5 * 0.5 + 0.5 = 18.7409…; half of it = +0.5
    const need10 = Math.pow(11, 1.5) * 0.5 + 0.5;
    expect(effectiveLevel(sk('Swords', 10, need10 / 2))).toBeCloseTo(10.5, 10);
  });

  it('caps the fraction at one level and the level at 100', () => {
    expect(effectiveLevel(sk('Run', 10, 1_000))).toBe(11);
    expect(effectiveLevel(sk('Run', 100, 50))).toBe(100);
  });
});

describe('toSkillTrend (ROK-1882)', () => {
  it('returns days: [] with no history', () => {
    expect(toSkillTrend([])).toEqual({ days: [] });
  });

  it('gains are end − start in effective levels; a new skill starts at 0', () => {
    const need5 = Math.pow(6, 1.5) * 0.5 + 0.5;
    const trend = toSkillTrend([
      day(
        '2026-10-20',
        [sk('Swords', 5, 0)],
        [sk('Swords', 6, 0), sk('Bows', 2, 0)],
      ),
      day('2026-10-18', [sk('Axes', 5, 0)], [sk('Axes', 5, need5 / 4)]),
    ]);
    expect(trend.days.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-18']);
    expect(trend.days[0]?.gains).toEqual({ Swords: 1, Bows: 2 });
    expect(trend.days[1]?.gains.Axes).toBeCloseTo(0.25, 10);
  });

  it('passes a negative (death penalty) gain through', () => {
    const trend = toSkillTrend([
      day(
        '2026-10-21',
        [sk('Run', 41), sk('Swords', 30)],
        [sk('Run', 39.8), sk('Swords', 28.5)],
      ),
    ]);
    expect(trend.days[0]?.gains.Run).toBeCloseTo(-1.2, 10);
    expect(trend.days[0]?.gains.Swords).toBeCloseTo(-1.5, 10);
  });

  it('drops |gain| < 0.05 either sign, keeps exactly 0.05, keeps the empty day', () => {
    const trend = toSkillTrend([
      day(
        '2026-10-21',
        [sk('A', 10), sk('B', 10), sk('C', 10), sk('D', 10)],
        [sk('A', 10.04), sk('B', 9.96), sk('C', 10.05), sk('D', 10)],
      ),
      day('2026-10-19', [sk('A', 9)], [sk('A', 9.01)]),
    ]);
    expect(Object.keys(trend.days[0]?.gains ?? {})).toEqual(['C']);
    expect(trend.days[1]).toEqual({ date: '2026-10-19', gains: {} });
  });

  it('keeps at most 3 play days, newest first, whatever the input order', () => {
    const rows = ['2026-10-01', '2026-10-15', '2026-10-08', '2026-10-20'].map(
      (d) => day(d, [sk('Run', 1)], [sk('Run', 2)]),
    );
    expect(toSkillTrend(rows).days.map((d) => d.date)).toEqual([
      '2026-10-20',
      '2026-10-15',
      '2026-10-08',
    ]);
  });
});
