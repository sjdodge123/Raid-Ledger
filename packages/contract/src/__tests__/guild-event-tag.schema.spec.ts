/**
 * ROK-1787: guild tagging on events + the GuildRaids read payload.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  CreateEventSchema,
  UpdateEventSchema,
  EventResponseSchema,
} from '../events.schema.js';
import { GuildRaidsSchema } from '../guild-raids.schema.js';

const create = {
  title: 'Raid night',
  startTime: '2026-11-01T19:00:00.000Z',
  endTime: '2026-11-01T22:00:00.000Z',
};

describe('CreateEventSchema.guildId (ROK-1787)', () => {
  it('rejects guildId without gameId with the refine message', () => {
    const r = CreateEventSchema.safeParse({ ...create, guildId: 4 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('guildId requires gameId');
    expect(r.error?.issues[0]?.path).toEqual(['guildId']);
  });
  it('accepts guildId with gameId', () => {
    const r = CreateEventSchema.safeParse({ ...create, gameId: 2, guildId: 4 });
    expect(r.success).toBe(true);
    expect(r.data?.guildId).toBe(4);
  });
  it('rejects a non-positive guildId', () => {
    expect(
      CreateEventSchema.safeParse({ ...create, gameId: 2, guildId: 0 }).success,
    ).toBe(false);
  });
});

describe('UpdateEventSchema.guildId (ROK-1787)', () => {
  it('accepts null to clear the tag', () => {
    const r = UpdateEventSchema.safeParse({ guildId: null });
    expect(r.success).toBe(true);
    expect(r.data?.guildId).toBeNull();
  });
  it('accepts a guild id without gameId (server resolves the existing game)', () => {
    expect(UpdateEventSchema.safeParse({ guildId: 7 }).data?.guildId).toBe(7);
  });
});

describe('EventResponseSchema.guildId (ROK-1787)', () => {
  it('keeps guildId when present', () => {
    const shape = EventResponseSchema.shape.guildId;
    expect(shape.parse(3)).toBe(3);
    expect(shape.parse(null)).toBeNull();
    expect(shape.parse(undefined)).toBeUndefined();
  });
});

describe('GuildRaidsSchema (ROK-1787)', () => {
  const card = {
    id: 1,
    title: 'MC',
    startTime: '2026-11-01T19:00:00.000Z',
    endTime: '2026-11-01T22:00:00.000Z',
    signupCount: 12,
    needed: 20,
    viewerStatus: 'signed_up',
  };
  const payload = {
    upcoming: [card],
    recent: [],
    schedule: [],
    composition: null,
    attendance: { windowWeeks: 8, rows: [] },
    nextRaid: card,
  };
  it('parses a minimal payload', () => {
    expect(GuildRaidsSchema.safeParse(payload).success).toBe(true);
  });
  it('rejects a window other than 8 weeks', () => {
    const bad = { ...payload, attendance: { windowWeeks: 4, rows: [] } };
    expect(GuildRaidsSchema.safeParse(bad).success).toBe(false);
  });
});
