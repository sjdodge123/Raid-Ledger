/**
 * ROK-2352 L1 — `CreateEventSchema.lfgGroupKey` (needs `lfgGameId`) and the
 * blizzard plugin's `lfg-grouping` behaviour declaration.
 */
import { describe, expect, it } from 'vitest';
import { CreateEventSchema } from '../events.schema.js';
import { HUB_BEHAVIOUR_KINDS } from '../plugin-hub-manifest.schema.js';
import { hubManifestFor } from '../plugin-hub-manifests.js';

const create = {
  title: 'Deadmines', startTime: '2026-11-01T19:00:00.000Z', endTime: '2026-11-01T21:00:00.000Z',
};

describe('CreateEventSchema.lfgGroupKey (ROK-2352)', () => {
  it('accepts a group key alongside lfgGameId', () => {
    const r = CreateEventSchema.parse({ ...create, gameId: 9, lfgGameId: 9, lfgGroupKey: 'dungeon:36' });
    expect(r.lfgGroupKey).toBe('dungeon:36');
  });
  it('rejects lfgGroupKey without lfgGameId with the refine message', () => {
    const r = CreateEventSchema.safeParse({ ...create, gameId: 9, lfgGroupKey: 'dungeon:36' });
    expect(r.error?.issues[0]?.message).toBe('lfgGroupKey requires lfgGameId');
    expect(r.error?.issues[0]?.path).toEqual(['lfgGroupKey']);
  });
  it('rejects a key that breaks the grammar', () => {
    const r = CreateEventSchema.safeParse({ ...create, gameId: 9, lfgGameId: 9, lfgGroupKey: 'Dungeon' });
    expect(r.error?.issues[0]?.path).toEqual(['lfgGroupKey']);
  });
  it('accepts the instance picked for an Any-dungeon lock-in', () => {
    const r = CreateEventSchema.parse({ ...create, gameId: 9, lfgGameId: 9, lfgGroupKey: '', lfgChosenGroupKey: 'raid:409' });
    expect(r.lfgChosenGroupKey).toBe('raid:409');
  });
  it('rejects lfgChosenGroupKey without lfgGameId with the refine message', () => {
    const r = CreateEventSchema.safeParse({ ...create, gameId: 9, lfgChosenGroupKey: 'raid:409' });
    expect(r.error?.issues[0]?.message).toBe('lfgChosenGroupKey requires lfgGameId');
  });
  it('keeps events without the field valid', () => {
    expect(CreateEventSchema.safeParse({ ...create, gameId: 9, lfgGameId: 9 }).success).toBe(true);
  });
});

describe('lfg-grouping behaviour (ROK-2352)', () => {
  it('is a declarable hub behaviour kind', () => {
    expect(HUB_BEHAVIOUR_KINDS).toContain('lfg-grouping');
  });
  it('is declared by the blizzard plugin as wow-instance-lfg', () => {
    const b = hubManifestFor('blizzard')?.behaviours.filter((x) => x.kind === 'lfg-grouping');
    expect(b?.map((x) => x.id)).toEqual(['wow-instance-lfg']);
  });
});
