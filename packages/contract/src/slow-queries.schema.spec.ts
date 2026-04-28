import { describe, it, expect } from 'vitest';
import {
  SourceEnum,
  SlowQueryEntrySchema,
  SlowQuerySnapshotSchema,
  SlowQueryDigestSchema,
} from './slow-queries.schema.js';

describe('SlowQueryEntrySchema', () => {
  it('accepts a valid entry payload', () => {
    const payload = {
      queryid: '12345678901234567890',
      queryText: 'SELECT * FROM events WHERE id = $1',
      calls: 42,
      meanExecTimeMs: 120.5,
      totalExecTimeMs: 5061,
    };
    expect(SlowQueryEntrySchema.safeParse(payload).success).toBe(true);
  });

  it('rejects negative calls', () => {
    const payload = {
      queryid: '12345',
      queryText: 'SELECT 1',
      calls: -1,
      meanExecTimeMs: 5,
      totalExecTimeMs: 5,
    };
    expect(SlowQueryEntrySchema.safeParse(payload).success).toBe(false);
  });

  it('rejects missing meanExecTimeMs', () => {
    const payload = {
      queryid: '12345',
      queryText: 'SELECT 1',
      calls: 1,
      totalExecTimeMs: 5,
    };
    expect(SlowQueryEntrySchema.safeParse(payload).success).toBe(false);
  });
});

describe('SlowQuerySnapshotSchema', () => {
  it('rejects non-datetime capturedAt', () => {
    const payload = {
      id: 1,
      capturedAt: 'not-a-date',
      source: 'cron',
    };
    expect(SlowQuerySnapshotSchema.safeParse(payload).success).toBe(false);
  });
});

describe('SourceEnum', () => {
  it('rejects sources outside cron/manual', () => {
    expect(SourceEnum.safeParse('discord').success).toBe(false);
    expect(SourceEnum.safeParse('cron').success).toBe(true);
    expect(SourceEnum.safeParse('manual').success).toBe(true);
  });
});

describe('SlowQueryDigestSchema', () => {
  it('accepts baseline as null', () => {
    const payload = {
      snapshot: {
        id: 7,
        capturedAt: '2026-04-28T06:00:00.000Z',
        source: 'cron',
      },
      baseline: null,
      entries: [],
    };
    expect(SlowQueryDigestSchema.safeParse(payload).success).toBe(true);
  });
});
