/**
 * ROK-2187 — GG delivery scheduling: default day (Q1), date/hour gate in the
 * community tz, DM offset (R7) and the announce key.
 */
import {
  defaultGgDeliveryDate,
  effectiveGgDeliveryDate,
  ggAnnounceKey,
  isGgDeliveryDue,
  isGgDmWaveOpen,
  parseGgDate,
} from './gg-delivery.schedule';
import { readGgDeliverySettings } from './gg-delivery.settings';
import { SETTING_KEYS, type SettingKey } from '../../../drizzle/schema';

describe('defaultGgDeliveryDate', () => {
  it.each([
    [2026, '2026-12-07'], // Dec 1 Tue → week two Mon Dec 7
    [2025, '2025-12-08'], // Dec 1 Mon → week two Mon Dec 8
    [2024, '2024-12-02'], // Dec 1 Sun → week two Mon Dec 2
    [2027, '2027-12-06'], // Dec 1 Wed → week two Mon Dec 6
  ])('%i → %s', (year, expected) => {
    expect(defaultGgDeliveryDate(year)).toBe(expected);
  });
});

describe('parseGgDate', () => {
  it('rejects malformed values', () => {
    expect(parseGgDate('2026-13-01')).toBeNull();
    expect(parseGgDate('nope')).toBeNull();
    expect(parseGgDate(null)).toBeNull();
    expect(parseGgDate('2026-12-07')).toEqual({
      year: 2026,
      month: 12,
      day: 7,
    });
  });
});

describe('isGgDeliveryDue', () => {
  const tz = 'America/New_York';
  // 18:00 New York on 2026-12-07 = 23:00Z.
  it('is false the hour before, true at and after the slot', () => {
    expect(
      isGgDeliveryDue(new Date('2026-12-07T22:59:00Z'), '2026-12-07', 18, tz),
    ).toBe(false);
    expect(
      isGgDeliveryDue(new Date('2026-12-07T23:00:00Z'), '2026-12-07', 18, tz),
    ).toBe(true);
    expect(
      isGgDeliveryDue(new Date('2026-12-20T10:00:00Z'), '2026-12-07', 18, tz),
    ).toBe(true);
  });

  it('never fires in the next calendar year from a stale date', () => {
    expect(
      isGgDeliveryDue(new Date('2027-01-05T12:00:00Z'), '2026-12-07', 18, tz),
    ).toBe(false);
  });

  it('is false for a malformed date', () => {
    expect(
      isGgDeliveryDue(new Date('2026-12-20T10:00:00Z'), 'bad', 18, tz),
    ).toBe(false);
  });
});

describe('effectiveGgDeliveryDate — a saved date never pins the year', () => {
  const tz = 'America/New_York';
  it('treats a date saved in a past year as unset → this year still ships', () => {
    const date = effectiveGgDeliveryDate('2026-12-14', 2027);
    expect(date).toBe('2027-12-06');
    // 18:00 New York on 2027-12-13 = 23:00Z.
    const now = new Date('2027-12-13T23:00:00Z');
    expect(isGgDeliveryDue(now, date, 18, tz)).toBe(true);
    expect(Number(date.slice(0, 4))).toBe(2027);
  });

  it('honours an explicit date for this year (and a later year)', () => {
    expect(effectiveGgDeliveryDate('2027-12-14', 2027)).toBe('2027-12-14');
    expect(effectiveGgDeliveryDate(' 2028-12-01 ', 2027)).toBe('2028-12-01');
    expect(
      isGgDeliveryDue(new Date('2027-12-13T23:00:00Z'), '2027-12-14', 18, tz),
    ).toBe(false);
  });

  it('falls back to the default for unset or malformed values', () => {
    expect(effectiveGgDeliveryDate(null, 2027)).toBe('2027-12-06');
    expect(effectiveGgDeliveryDate('2027-13-01', 2027)).toBe('2027-12-06');
  });
});

describe('isGgDmWaveOpen', () => {
  const at = new Date('2026-12-07T23:00:00Z');
  it('opens exactly offset minutes after the announcement', () => {
    expect(isGgDmWaveOpen(new Date('2026-12-07T23:14:59Z'), at, 15)).toBe(
      false,
    );
    expect(isGgDmWaveOpen(new Date('2026-12-07T23:15:00Z'), at, 15)).toBe(true);
  });
});

it('ggAnnounceKey is year-scoped', () => {
  expect(ggAnnounceKey(2026)).toBe('gg:2026:announce');
});

describe("readGgDeliverySettings — last year's saved panel draft", () => {
  it("reads a stored past-year date as this year's default (GG 2027 ships)", async () => {
    const stored: Partial<Record<SettingKey, string>> = {
      [SETTING_KEYS.GG_ENABLED]: 'true',
      [SETTING_KEYS.GG_DELIVERY_DATE]: '2026-12-14',
    };
    const store = {
      get: (k: SettingKey): Promise<string | null> =>
        Promise.resolve(stored[k] ?? null),
    };
    const cfg = await readGgDeliverySettings(store, 2027);
    expect(cfg.enabled).toBe(true);
    expect(cfg.deliveryDate).toBe('2027-12-06');
  });
});
