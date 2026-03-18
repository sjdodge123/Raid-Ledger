/**
 * Adversarial unit tests for departure-grace.helpers.ts (ROK-851).
 *
 * Focuses on:
 * - wasEventFullBeforeDeparture() — the core capacity-check guard
 * - resolveEventCapacity() — tested indirectly via wasEventFullBeforeDeparture
 *   for both maxAttendees and slotConfig capacity sources
 *
 * Acceptance criteria verified:
 * AC1 — notification NOT sent when event was not full before departure
 * AC2 — Discord promote DM NOT sent when event was not full
 * AC3 — Both notifications fire when event WAS full
 * AC4 — "Full" = active signup count + 1 (the departed member) >= capacity
 * AC5 — Events with no capacity limit (unlimited) never trigger notifications
 */
import { wasEventFullBeforeDeparture } from './departure-grace.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { createMockEvent } from '../../common/testing/factories';

let mockDb: MockDb;

beforeEach(() => {
  mockDb = createDrizzleMock();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── AC5: Unlimited events never trigger notifications ────────────────────

describe('wasEventFullBeforeDeparture — unlimited event (no capacity)', () => {
  it('returns false when event has no maxAttendees and no slotConfig', async () => {
    const event = createMockEvent({ maxAttendees: null, slotConfig: null });

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('does not query the database when event has no capacity limit', async () => {
    const event = createMockEvent({ maxAttendees: null, slotConfig: null });

    await wasEventFullBeforeDeparture(mockDb as never, event as never);

    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ─── AC3 + AC4: maxAttendees capacity — was full ──────────────────────────

describe('wasEventFullBeforeDeparture — maxAttendees: event was full', () => {
  it('returns true when active signups + 1 equals maxAttendees exactly (at boundary)', async () => {
    const event = createMockEvent({ maxAttendees: 5 });
    mockDb.limit.mockResolvedValueOnce([{ count: 4 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });

  it('returns true when active signups + 1 exceeds maxAttendees (over capacity)', async () => {
    const event = createMockEvent({ maxAttendees: 5 });
    mockDb.limit.mockResolvedValueOnce([{ count: 6 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });

  it('returns true when capacity is 1 and 0 active signups remain (last slot departed)', async () => {
    const event = createMockEvent({ maxAttendees: 1 });
    mockDb.limit.mockResolvedValueOnce([{ count: 0 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });
});

// ─── AC1 + AC4: maxAttendees capacity — was NOT full ─────────────────────

describe('wasEventFullBeforeDeparture — maxAttendees: event was not full', () => {
  it('returns false when active signups + 1 is below capacity', async () => {
    const event = createMockEvent({ maxAttendees: 10 });
    mockDb.limit.mockResolvedValueOnce([{ count: 5 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
  });

  it('returns false when active signups + 1 is one below capacity (boundary)', async () => {
    const event = createMockEvent({ maxAttendees: 10 });
    mockDb.limit.mockResolvedValueOnce([{ count: 8 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
  });

  it('returns false with 0 active signups and capacity of 10', async () => {
    const event = createMockEvent({ maxAttendees: 10 });
    mockDb.limit.mockResolvedValueOnce([{ count: 0 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
  });
});

// ─── AC3 + AC4: slotConfig generic capacity ───────────────────────────────

describe('wasEventFullBeforeDeparture — slotConfig generic: event was full', () => {
  it('returns true when generic slotConfig capacity met (count + 1 >= player slots)', async () => {
    const event = createMockEvent({
      slotConfig: { type: 'generic', player: 6 },
    });
    mockDb.limit.mockResolvedValueOnce([{ count: 5 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });

  it('returns true when count exactly equals player - 1 (at capacity boundary)', async () => {
    const event = createMockEvent({
      slotConfig: { type: 'generic', player: 3 },
    });
    mockDb.limit.mockResolvedValueOnce([{ count: 2 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });
});

// ─── AC1: slotConfig generic capacity — was NOT full ─────────────────────

describe('wasEventFullBeforeDeparture — slotConfig generic: event was not full', () => {
  it('returns false when active signups + 1 is below generic player capacity', async () => {
    const event = createMockEvent({
      slotConfig: { type: 'generic', player: 10 },
    });
    mockDb.limit.mockResolvedValueOnce([{ count: 3 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
  });
});

// ─── AC3 + AC4: slotConfig mmo capacity ──────────────────────────────────

describe('wasEventFullBeforeDeparture — slotConfig mmo: event was full', () => {
  it('returns true when MMO slotConfig is at capacity (tank+healer+dps+flex)', async () => {
    // Default mmo: tank=2, healer=4, dps=14, flex=5 → 25 total
    const event = createMockEvent({
      slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 5 },
    });
    mockDb.limit.mockResolvedValueOnce([{ count: 24 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });

  it('returns true for custom MMO capacity when count + 1 equals capacity', async () => {
    // tank=1, healer=2, dps=5, flex=2 → 10 total
    const event = createMockEvent({
      slotConfig: { type: 'mmo', tank: 1, healer: 2, dps: 5, flex: 2 },
    });
    mockDb.limit.mockResolvedValueOnce([{ count: 9 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });
});

// ─── AC1: slotConfig mmo capacity — was NOT full ─────────────────────────

describe('wasEventFullBeforeDeparture — slotConfig mmo: event was not full', () => {
  it('returns false when MMO slots have room remaining', async () => {
    // tank=2, healer=4, dps=14, flex=5 → 25 total
    const event = createMockEvent({
      slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 5 },
    });
    mockDb.limit.mockResolvedValueOnce([{ count: 20 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
  });
});

// ─── AC5: slotConfig with unknown type returns null capacity ─────────────

describe('wasEventFullBeforeDeparture — slotConfig unknown type', () => {
  it('returns false when slotConfig type is unrecognised (treated as no capacity)', async () => {
    const event = createMockEvent({
      slotConfig: { type: 'unknown-future-type', capacity: 10 },
    });

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ─── AC5: slotConfig with missing player field (generic) ─────────────────

describe('wasEventFullBeforeDeparture — slotConfig generic with null player', () => {
  it('returns false when generic slotConfig has no player count defined', async () => {
    const event = createMockEvent({ slotConfig: { type: 'generic' } });

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});

// ─── slotConfig takes precedence over maxAttendees ───────────────────────

describe('wasEventFullBeforeDeparture — slotConfig takes priority over maxAttendees', () => {
  it('uses slotConfig capacity when both slotConfig and maxAttendees are set', async () => {
    // slotConfig: player=6 → should use 6, not maxAttendees=100
    const event = createMockEvent({
      slotConfig: { type: 'generic', player: 6 },
      maxAttendees: 100,
    });
    // 5 active + 1 departed = 6 → exactly at slotConfig capacity
    mockDb.limit.mockResolvedValueOnce([{ count: 5 }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    // Would be false if using maxAttendees=100, true if using slotConfig=6
    expect(result).toBe(true);
  });
});

// ─── count is coerced to Number (DB returns string) ──────────────────────

describe('wasEventFullBeforeDeparture — count coercion from DB string', () => {
  it('correctly handles numeric string from DB count (SQL count() returns string)', async () => {
    const event = createMockEvent({ maxAttendees: 5 });
    // Simulate DB returning count as a string (postgres-js behaviour)
    mockDb.limit.mockResolvedValueOnce([{ count: '4' }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(true);
  });

  it('returns false for numeric string count below capacity', async () => {
    const event = createMockEvent({ maxAttendees: 10 });
    mockDb.limit.mockResolvedValueOnce([{ count: '3' }]);

    const result = await wasEventFullBeforeDeparture(
      mockDb as never,
      event as never,
    );

    expect(result).toBe(false);
  });
});
