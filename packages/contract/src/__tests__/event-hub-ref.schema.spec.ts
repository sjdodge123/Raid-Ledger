/**
 * ROK-1893 §10.6 — `hub` on the event payload: absent / `null` / a visible
 * hub ref are accepted; an unknown hub `kind` is rejected.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import { EventHubRefSchema, EventResponseSchema } from '../events.schema.js';

const event = {
  id: 1,
  title: 'Raid night',
  description: null,
  startTime: '2026-11-01T19:00:00.000Z',
  endTime: '2026-11-01T22:00:00.000Z',
  creator: { id: 1, username: 'leader', avatar: null },
  game: null,
  signupCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('EventHubRefSchema (ROK-1893)', () => {
  it('accepts a hub ref of each kind', () => {
    for (const kind of ['wow_guild', 'game_server', 'game_community'] as const) {
      expect(EventHubRefSchema.safeParse({ id: 7, name: 'Fable', kind }).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    const r = EventHubRefSchema.safeParse({ id: 7, name: 'Fable', kind: 'raid_team' });
    expect(r.success).toBe(false);
  });
});

describe('EventResponseSchema.hub (ROK-1893)', () => {
  it('accepts the field absent', () => {
    const r = EventResponseSchema.safeParse(event);
    expect(r.success).toBe(true);
    expect(r.data?.hub).toBeUndefined();
  });

  it('accepts hub: null (untagged or hidden hub)', () => {
    const r = EventResponseSchema.safeParse({ ...event, hub: null });
    expect(r.success).toBe(true);
    expect(r.data?.hub).toBeNull();
  });

  it('accepts a valid hub ref and keeps it', () => {
    const hub = { id: 7, name: 'Fable', kind: 'wow_guild' };
    const r = EventResponseSchema.safeParse({ ...event, hub });
    expect(r.success).toBe(true);
    expect(r.data?.hub).toEqual(hub);
  });

  it('rejects a hub with an unknown kind', () => {
    const r = EventResponseSchema.safeParse({ ...event, hub: { id: 7, name: 'Fable', kind: 'raid_team' } });
    expect(r.success).toBe(false);
  });
});
