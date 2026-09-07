/**
 * ROK-1479 — unit coverage for the urgency-aware write path.
 *
 * These assert the ARITHMETIC each write commits, not that a query ran: the
 * whole feature is "which instant lands in `expires_at`", so every case reads
 * the value the helper handed the driver and compares it to a horizon.
 *
 * The A3 ruling is the reason `refreshGroupExpiry` is tested with a MIXED
 * group: a +1 must push the week row to +14 d and each now row to +its OWN
 * TTL. Collapsing that back to one blanket update is exactly the regression
 * this file exists to catch.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  insertIntent,
  reviveIntent,
  toIntentDto,
  type LfgIntentRow,
} from './lfg-write.helpers';
import { bumpIntentUrgency, refreshGroupExpiry } from './lfg-urgency.helpers';
import type { LfgDb } from './lfg-query.helpers';
import {
  LFG_DEFAULT_NOW_TTL_MINUTES,
  LFG_EXPIRY_CRON_EXPRESSION,
  LFG_EXPIRY_DAYS,
  LFG_NOW_TTL_MINUTES,
  computeNowExpiresAt,
} from './lfg.constants';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NOW = new Date('2026-09-05T12:00:00.000Z');

function intentRow(overrides: Partial<LfgIntentRow> = {}): LfgIntentRow {
  return {
    id: 7,
    userId: 11,
    gameId: 22,
    status: 'active',
    visibility: 'local',
    urgency: 'week',
    ttlMinutes: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    expiresAt: new Date('2026-09-15T00:00:00.000Z'),
    convertedToPollId: null,
    convertedToEventId: null,
    ...overrides,
  };
}

/** Every `.set()` / `.values()` payload the helper handed the driver. */
function writtenPayloads(mock: jest.Mock): Record<string, unknown>[] {
  return mock.mock.calls.map(([arg]) => arg as Record<string, unknown>);
}

/** Horizon, in ms from the frozen clock, of each write's `expiresAt`. */
function horizonsFrom(mock: jest.Mock): number[] {
  return writtenPayloads(mock).map(
    (payload) => (payload.expiresAt as Date).getTime() - NOW.getTime(),
  );
}

describe('LFG urgency constants', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers exactly the two now-TTLs the DB CHECK constraint allows', () => {
    expect([...LFG_NOW_TTL_MINUTES]).toEqual([30, 60]);
  });

  it('defaults an absent now-TTL to 30 minutes', () => {
    expect(LFG_DEFAULT_NOW_TTL_MINUTES).toBe(30);
  });

  it.each([
    [30, 30 * MINUTE_MS],
    [60, 60 * MINUTE_MS],
  ])('computeNowExpiresAt(%i) lands %i ms out', (ttl, expected) => {
    expect(computeNowExpiresAt(ttl, NOW).getTime() - NOW.getTime()).toBe(
      expected,
    );
  });

  it('defaults computeNowExpiresAt to the current instant', () => {
    expect(computeNowExpiresAt(60).getTime() - NOW.getTime()).toBe(
      60 * MINUTE_MS,
    );
  });

  it('sweeps every 5 minutes so a 30-minute intent is never stale for long', () => {
    expect(LFG_EXPIRY_CRON_EXPRESSION).toBe('0 */5 * * * *');
  });
});

describe('insertIntent', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockDb = createDrizzleMock();
    mockDb.returning.mockResolvedValue([intentRow()]);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('writes a week intent 14 days out with no TTL when no urgency is asked for', async () => {
    await insertIntent(mockDb as unknown as LfgDb, 11, 22);
    const [values] = writtenPayloads(mockDb.values);
    expect(values.urgency).toBe('week');
    expect(values.ttlMinutes).toBeNull();
    expect(horizonsFrom(mockDb.values)).toEqual([LFG_EXPIRY_DAYS * DAY_MS]);
  });

  it.each([
    [30, 30 * MINUTE_MS],
    [60, 60 * MINUTE_MS],
  ])(
    'writes a now intent with ttlMinutes=%i expiring %i ms out',
    async (ttlMinutes, expected) => {
      await insertIntent(mockDb as unknown as LfgDb, 11, 22, {
        urgency: 'now',
        ttlMinutes: ttlMinutes as 30 | 60,
      });
      const [values] = writtenPayloads(mockDb.values);
      expect(values.urgency).toBe('now');
      expect(values.ttlMinutes).toBe(ttlMinutes);
      expect(horizonsFrom(mockDb.values)).toEqual([expected]);
    },
  );

  it('treats a now intent with no explicit TTL as 30 minutes', async () => {
    await insertIntent(mockDb as unknown as LfgDb, 11, 22, { urgency: 'now' });
    const [values] = writtenPayloads(mockDb.values);
    expect(values.ttlMinutes).toBe(30);
    expect(horizonsFrom(mockDb.values)).toEqual([30 * MINUTE_MS]);
  });
});

describe('reviveIntent', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockDb = createDrizzleMock();
    mockDb.returning.mockResolvedValue([intentRow()]);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('revives on the REQUESTED class, not the class the dead row held', async () => {
    await reviveIntent(mockDb as unknown as LfgDb, 7, {
      urgency: 'now',
      ttlMinutes: 60,
    });
    const [set] = writtenPayloads(mockDb.set);
    expect(set.urgency).toBe('now');
    expect(set.ttlMinutes).toBe(60);
    expect(horizonsFrom(mockDb.set)).toEqual([60 * MINUTE_MS]);
  });

  it('defaults to the weekly horizon when no class is requested', async () => {
    await reviveIntent(mockDb as unknown as LfgDb, 7);
    expect(horizonsFrom(mockDb.set)).toEqual([LFG_EXPIRY_DAYS * DAY_MS]);
  });
});

describe('bumpIntentUrgency', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockDb = createDrizzleMock();
    mockDb.returning.mockResolvedValue([intentRow()]);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shortens a week row to the now horizon', async () => {
    const row = intentRow({ urgency: 'week', ttlMinutes: null });
    const result = await bumpIntentUrgency(mockDb as unknown as LfgDb, row, {
      urgency: 'now',
      ttlMinutes: 30,
    });
    expect(result).not.toBeNull();
    const [set] = writtenPayloads(mockDb.set);
    expect(set.urgency).toBe('now');
    expect(set.ttlMinutes).toBe(30);
    expect(horizonsFrom(mockDb.set)).toEqual([30 * MINUTE_MS]);
  });

  it('lengthens a now row back to the weekly horizon and clears its TTL', async () => {
    const row = intentRow({ urgency: 'now', ttlMinutes: 30 });
    await bumpIntentUrgency(mockDb as unknown as LfgDb, row, {
      urgency: 'week',
    });
    const [set] = writtenPayloads(mockDb.set);
    expect(set.urgency).toBe('week');
    expect(set.ttlMinutes).toBeNull();
    expect(horizonsFrom(mockDb.set)).toEqual([LFG_EXPIRY_DAYS * DAY_MS]);
  });

  it('is a no-op when a week row is re-hearted as a week row', async () => {
    const row = intentRow({ urgency: 'week', ttlMinutes: null });
    const result = await bumpIntentUrgency(mockDb as unknown as LfgDb, row, {
      urgency: 'week',
    });
    expect(result).toBeNull();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('restarts the clock when a now row is re-hearted as a now row', async () => {
    const row = intentRow({ urgency: 'now', ttlMinutes: 60 });
    await bumpIntentUrgency(mockDb as unknown as LfgDb, row, {
      urgency: 'now',
      ttlMinutes: 60,
    });
    expect(horizonsFrom(mockDb.set)).toEqual([60 * MINUTE_MS]);
  });

  it('reports "not applied" when the guarded UPDATE matched no active row', async () => {
    mockDb.returning.mockResolvedValue([]);
    const row = intentRow({ urgency: 'week' });
    const result = await bumpIntentUrgency(mockDb as unknown as LfgDb, row, {
      urgency: 'now',
    });
    expect(result).toBeNull();
  });
});

describe('refreshGroupExpiry (A3 — per-row horizons)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockDb = createDrizzleMock();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('refreshes the week rows to +14 d and each now bucket to its OWN TTL', async () => {
    await refreshGroupExpiry(mockDb as unknown as LfgDb, 22);
    expect(horizonsFrom(mockDb.set)).toEqual([
      LFG_EXPIRY_DAYS * DAY_MS,
      30 * MINUTE_MS,
      60 * MINUTE_MS,
    ]);
  });

  it('never rewrites urgency or ttlMinutes — a +1 moves the clock only', async () => {
    await refreshGroupExpiry(mockDb as unknown as LfgDb, 22);
    for (const payload of writtenPayloads(mockDb.set)) {
      expect(Object.keys(payload)).toEqual(['expiresAt']);
    }
  });
});

describe('toIntentDto', () => {
  it('projects the stored urgency and TTL onto the wire DTO', () => {
    const dto = toIntentDto(intentRow({ urgency: 'now', ttlMinutes: 60 }));
    expect(dto.urgency).toBe('now');
    expect(dto.ttlMinutes).toBe(60);
  });

  it('reports a null TTL for a weekly intent', () => {
    const dto = toIntentDto(intentRow({ urgency: 'week', ttlMinutes: null }));
    expect(dto.urgency).toBe('week');
    expect(dto.ttlMinutes).toBeNull();
  });
});
