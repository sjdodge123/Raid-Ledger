import {
  BENCH_TITLE_PREFIX,
  copyIsBusy,
  copySummary,
  TENTATIVE_TITLE_PREFIX,
} from './copy-presentation.helpers';

const T = 'Molten Core';

describe('copy presentation (D4 + F11)', () => {
  it('confirmed → Busy, plain title', () => {
    const c = { title: T, tentative: false, benched: false };
    expect(copySummary(c)).toBe('Molten Core');
    expect(copyIsBusy(c)).toBe(true);
  });

  it('benched absent → treated as not benched', () => {
    expect(copySummary({ title: T, tentative: false })).toBe('Molten Core');
    expect(copyIsBusy({ title: T, tentative: false })).toBe(true);
  });

  it('tentative → Free, "(Tentative) " title', () => {
    const c = { title: T, tentative: true, benched: false };
    expect(copySummary(c)).toBe('(Tentative) Molten Core');
    expect(copyIsBusy(c)).toBe(false);
  });

  it('benched (F11) → Free, "(Bench) " title', () => {
    const c = { title: T, tentative: false, benched: true };
    expect(copySummary(c)).toBe('(Bench) Molten Core');
    expect(copyIsBusy(c)).toBe(false);
  });

  it('tentative + benched → bench wins: Free, "(Bench) " only', () => {
    const c = { title: T, tentative: true, benched: true };
    expect(copySummary(c)).toBe('(Bench) Molten Core');
    expect(copyIsBusy(c)).toBe(false);
  });

  it('prefixes are the ruled strings', () => {
    expect(BENCH_TITLE_PREFIX).toBe('(Bench) ');
    expect(TENTATIVE_TITLE_PREFIX).toBe('(Tentative) ');
  });
});
