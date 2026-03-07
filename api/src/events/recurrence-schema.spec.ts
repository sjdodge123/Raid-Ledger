/**
 * Unit tests for RecurrenceSchema and CreateEventSchema (ROK-426)
 *
 * Verifies that the `recurrence.until` field accepts both UTC ("Z") and
 * offset ("-05:00", "+09:00") datetime formats, that all recurrence
 * frequencies are accepted, and that non-repeating event creation remains
 * unaffected.
 */
import { RecurrenceSchema, CreateEventSchema } from '@raid-ledger/contract';

// ─── RecurrenceSchema — valid until formats ──────────────────────────────────

function testAcceptsUtcDatetime() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30T23:59:59.000Z',
  });
  expect(result.success).toBe(true);
}

function testAcceptsNegativeOffset() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30T23:59:59.000-05:00',
  });
  expect(result.success).toBe(true);
}

function testAcceptsPositiveOffset() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30T23:59:59.000+09:00',
  });
  expect(result.success).toBe(true);
}

function testAcceptsFractionalOffset() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30T23:59:59.000+05:30',
  });
  expect(result.success).toBe(true);
}

function testAcceptsZeroOffset() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30T23:59:59.000+00:00',
  });
  expect(result.success).toBe(true);
}

function testAcceptsNoMillisWithOffset() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30T23:59:59-05:00',
  });
  expect(result.success).toBe(true);
}

// ─── RecurrenceSchema — invalid until formats ────────────────────────────────

function testRejectsPlainDate() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '2026-05-30',
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.errors.map((e) => e.path.join('.'));
    expect(paths).toContain('until');
  }
}

function testRejectsNonIsoString() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: 'not-a-date',
  });
  expect(result.success).toBe(false);
}

function testRejectsEmptyString() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: '',
  });
  expect(result.success).toBe(false);
}

function testRejectsNull() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: null,
  });
  expect(result.success).toBe(false);
}

function testRejectsUndefined() {
  const result = RecurrenceSchema.safeParse({ frequency: 'weekly' });
  expect(result.success).toBe(false);
}

function testRejectsNumericTimestamp() {
  const result = RecurrenceSchema.safeParse({
    frequency: 'weekly',
    until: 1748649599000,
  });
  expect(result.success).toBe(false);
}

// ─── RecurrenceSchema — frequency field ──────────────────────────────────────

const validUntil = '2026-05-30T23:59:59.000-05:00';

function parsesFrequency(freq: string) {
  return RecurrenceSchema.safeParse({ frequency: freq, until: validUntil });
}

// ─── CreateEventSchema — recurrence integration ─────────────────────────────

const baseEvent = {
  title: 'Weekly Raid',
  startTime: '2026-03-01T19:00:00.000-05:00',
  endTime: '2026-03-01T22:00:00.000-05:00',
};

function testOffsetUntilIntegration() {
  const result = CreateEventSchema.safeParse({
    ...baseEvent,
    recurrence: {
      frequency: 'weekly',
      until: '2026-05-30T23:59:59.000-05:00',
    },
  });
  expect(result.success).toBe(true);
}

function testUtcUntilIntegration() {
  const result = CreateEventSchema.safeParse({
    ...baseEvent,
    recurrence: {
      frequency: 'weekly',
      until: '2026-05-30T23:59:59.000Z',
    },
  });
  expect(result.success).toBe(true);
}

function testBiweeklyIntegration() {
  const result = CreateEventSchema.safeParse({
    ...baseEvent,
    recurrence: {
      frequency: 'biweekly',
      until: '2026-05-30T23:59:59.000-05:00',
    },
  });
  expect(result.success).toBe(true);
}

function testMonthlyIntegration() {
  const result = CreateEventSchema.safeParse({
    ...baseEvent,
    recurrence: {
      frequency: 'monthly',
      until: '2026-05-30T23:59:59.000+09:00',
    },
  });
  expect(result.success).toBe(true);
}

function testRejectsBareDateIntegration() {
  const result = CreateEventSchema.safeParse({
    ...baseEvent,
    recurrence: { frequency: 'weekly', until: '2026-05-30' },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const allPaths = result.error.errors.map((e) => e.path.join('.'));
    expect(allPaths.some((p) => p.includes('until'))).toBe(true);
  }
}

function testNonRepeatingOmitsRecurrence() {
  const result = CreateEventSchema.safeParse(baseEvent);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.recurrence).toBeUndefined();
  }
}

function testRejectsEndBeforeStart() {
  const result = CreateEventSchema.safeParse({
    title: 'Bad Event',
    startTime: '2026-03-01T22:00:00.000-05:00',
    endTime: '2026-03-01T19:00:00.000-05:00',
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.errors.map((e) => e.path.join('.'));
    expect(paths).toContain('endTime');
  }
}

function testMinimalNonRepeating() {
  const result = CreateEventSchema.safeParse({
    title: 'Minimal Event',
    startTime: '2026-03-01T19:00:00.000Z',
    endTime: '2026-03-01T22:00:00.000Z',
  });
  expect(result.success).toBe(true);
}

describe('RecurrenceSchema — valid until formats', () => {
  it('accepts UTC datetime (Z suffix)', () => testAcceptsUtcDatetime());
  it('accepts negative UTC offset (-05:00)', () => testAcceptsNegativeOffset());
  it('accepts positive UTC offset (+09:00)', () => testAcceptsPositiveOffset());
  it('accepts fractional offset (+05:30)', () => testAcceptsFractionalOffset());
  it('accepts zero offset (+00:00)', () => testAcceptsZeroOffset());
  it('accepts datetime without ms but with offset', () =>
    testAcceptsNoMillisWithOffset());
});

describe('RecurrenceSchema — invalid until formats', () => {
  it('rejects plain date string', () => testRejectsPlainDate());
  it('rejects non-ISO string', () => testRejectsNonIsoString());
  it('rejects empty string', () => testRejectsEmptyString());
  it('rejects null', () => testRejectsNull());
  it('rejects undefined (field required)', () => testRejectsUndefined());
  it('rejects numeric timestamp', () => testRejectsNumericTimestamp());
});

describe('RecurrenceSchema — frequency field', () => {
  it('accepts "weekly"', () =>
    expect(parsesFrequency('weekly').success).toBe(true));
  it('accepts "biweekly"', () =>
    expect(parsesFrequency('biweekly').success).toBe(true));
  it('accepts "monthly"', () =>
    expect(parsesFrequency('monthly').success).toBe(true));
  it('rejects unknown frequency', () =>
    expect(parsesFrequency('daily').success).toBe(false));
  it('rejects missing frequency', () => {
    const result = RecurrenceSchema.safeParse({ until: validUntil });
    expect(result.success).toBe(false);
  });
});

describe('CreateEventSchema — recurrence integration', () => {
  it('creates repeating event with offset until', () =>
    testOffsetUntilIntegration());
  it('creates repeating event with UTC until', () => testUtcUntilIntegration());
  it('creates repeating biweekly event', () => testBiweeklyIntegration());
  it('creates repeating monthly event', () => testMonthlyIntegration());
  it('rejects bare date until', () => testRejectsBareDateIntegration());
  it('omits recurrence for non-repeating', () =>
    testNonRepeatingOmitsRecurrence());
  it('rejects end before start', () => testRejectsEndBeforeStart());
  it('creates minimal non-repeating event', () => testMinimalNonRepeating());
});
