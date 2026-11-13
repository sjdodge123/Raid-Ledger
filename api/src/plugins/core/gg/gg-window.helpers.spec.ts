/**
 * ROK-2187 — pure GG window / tier / slug helpers.
 */
import type { GgCardEnvelope } from '@raid-ledger/contract';
import {
  ggActivitySignals,
  ggActivityTier,
  ggYearWindow,
  mintGgShareSlug,
} from './gg-window.helpers';

function card(pluginSlug: string, cardId: string): GgCardEnvelope {
  return { pluginSlug, cardId, order: 1, payload: {} };
}

describe('ggYearWindow', () => {
  it('starts at Jan 1 00:00 community time and ends at compute time', () => {
    const now = new Date('2026-12-10T12:00:00Z');
    const w = ggYearWindow(2026, 'America/New_York', now);
    expect(w.start.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-10T12:00:00.000Z');
  });

  it('caps the end at the next Jan 1 when computing a past year', () => {
    const now = new Date('2027-03-01T00:00:00Z');
    const w = ggYearWindow(2026, 'Europe/Berlin', now);
    expect(w.start.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });

  it('falls back to UTC for a bogus zone', () => {
    const w = ggYearWindow(2026, 'Not/AZone', new Date('2026-06-01T00:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('ggActivitySignals / ggActivityTier', () => {
  it('ignores the always-present intro, summary and superlative cards', () => {
    const cards = [
      card('core', 'intro'),
      card('core', 'superlative'),
      card('core', 'summary'),
    ];
    expect(ggActivitySignals(cards)).toBe(0);
    expect(ggActivityTier(cards)).toBeNull();
  });

  it('counts the event cards as ONE signal → short', () => {
    const cards = [
      card('core', 'intro'),
      card('core', 'events'),
      card('core', 'on-time'),
      card('core', 'rhythm'),
      card('core', 'summary'),
    ];
    expect(ggActivitySignals(cards)).toBe(1);
    expect(ggActivityTier(cards)).toBe('short');
  });

  it('two distinct signals (events + a plugin card) → full', () => {
    const cards = [card('core', 'events'), card('valheim', 'deaths')];
    expect(ggActivitySignals(cards)).toBe(2);
    expect(ggActivityTier(cards)).toBe('full');
  });
});

describe('mintGgShareSlug', () => {
  it('is url-safe, ≥16 chars, and different each call', () => {
    const a = mintGgShareSlug();
    const b = mintGgShareSlug();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(a).not.toBe(b);
  });
});
