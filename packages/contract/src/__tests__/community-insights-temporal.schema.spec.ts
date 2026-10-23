/**
 * ROK-1936 — the temporal section gains an optional `timezone` (the IANA
 * zone its buckets were computed in). Snapshots stored before the field
 * existed must still parse.
 */
import { describe, expect, it } from 'vitest';
import { CommunityTemporalResponseSchema } from '../community-insights.schema';

const base = {
  snapshotDate: '2026-10-23',
  heatmap: [{ weekday: 6, hour: 21, activity: 1 }],
  peakHours: [{ weekday: 6, hour: 21, activity: 1 }],
};

describe('CommunityTemporalResponseSchema timezone (ROK-1936)', () => {
  it('parses a pre-ROK-1936 snapshot that has no timezone field', () => {
    const parsed = CommunityTemporalResponseSchema.parse(base);
    expect(parsed.timezone).toBeUndefined();
  });

  it('keeps the timezone the buckets were computed in', () => {
    const parsed = CommunityTemporalResponseSchema.parse({
      ...base,
      timezone: 'America/New_York',
    });
    expect(parsed.timezone).toBe('America/New_York');
  });
});
