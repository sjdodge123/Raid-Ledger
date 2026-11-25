/**
 * ROK-2352 L1 — the WoW plugin's per-hand detail (roles + optional character)
 * and the roster shape per instance size (spec §3.4).
 */
import { describe, expect, it } from 'vitest';
import {
  WowLfgHandDetailSchema,
  WowLfgMemberDetailSchema,
  wowRosterShapeForSize,
} from '../wow-lfg.schema.js';

const uuid = '0b6f6a52-5d0e-4a8a-9c39-3f1f9d1c2e11';

describe('WowLfgHandDetailSchema', () => {
  it('accepts 1..3 distinct roles with a character or null', () => {
    expect(WowLfgHandDetailSchema.parse({ roles: ['tank'], characterId: null }))
      .toEqual({ roles: ['tank'], characterId: null });
    expect(WowLfgHandDetailSchema.parse({ roles: ['tank', 'healer', 'dps'], characterId: uuid }).roles)
      .toHaveLength(3);
    expect(WowLfgHandDetailSchema.parse({ roles: ['dps'] })).toEqual({ roles: ['dps'] });
  });
  it.each([
    ['no roles', { roles: [], characterId: null }],
    ['four roles', { roles: ['tank', 'healer', 'dps', 'dps'], characterId: null }],
    ['a duplicate role', { roles: ['dps', 'dps'], characterId: null }],
    ['an unknown role', { roles: ['support'], characterId: null }],
    ['a non-uuid character', { roles: ['dps'], characterId: '42' }],
  ])('rejects %s', (_label, body) => {
    expect(WowLfgHandDetailSchema.safeParse(body).success).toBe(false);
  });
  it('is strict — an unknown key is an error, not silently dropped', () => {
    const r = WowLfgHandDetailSchema.safeParse({ roles: ['dps'], characterId: null, spec: 'fire' });
    expect(r.error?.issues[0]?.code).toBe('unrecognized_keys');
  });
});

describe('WowLfgMemberDetailSchema', () => {
  it('allows "role not set" (no roles) for a Discord-raised hand', () => {
    const m = { intentId: 5, roles: [], characterId: null, characterName: null, characterClass: null };
    expect(WowLfgMemberDetailSchema.parse(m)).toEqual(m);
  });
  it('carries the picked character for badges', () => {
    const m = { intentId: 5, roles: ['healer'], characterId: uuid, characterName: 'Mend', characterClass: 'Priest' };
    expect(WowLfgMemberDetailSchema.parse(m)).toEqual(m);
  });
});

describe('wowRosterShapeForSize (§3.4)', () => {
  it.each([
    [5, 'dungeon', { tank: 1, healer: 1, dps: 3 }],
    [3, 'dungeon', { tank: 1, healer: 1, dps: 3 }],
    [10, 'raid', { tank: 2, healer: 3, dps: 5 }],
    [20, 'raid', { tank: 2, healer: 4, dps: 14 }],
    [25, 'raid', { tank: 2, healer: 6, dps: 17 }],
    [40, 'raid', { tank: 4, healer: 10, dps: 26 }],
    [15, 'raid', { tank: 2, healer: 3, dps: 10 }],
    [12, 'raid', { tank: 1, healer: 2, dps: 9 }],
    [8, 'raid', { tank: 1, healer: 2, dps: 5 }],
  ] as const)('size %i (%s) → %o', (size, kind, shape) => {
    expect(wowRosterShapeForSize(size, kind)).toEqual(shape);
  });
  it('falls back to the category default when the size is unknown', () => {
    expect(wowRosterShapeForSize(null, 'dungeon')).toEqual({ tank: 1, healer: 1, dps: 3 });
    expect(wowRosterShapeForSize(null, 'raid')).toEqual({ tank: 2, healer: 3, dps: 5 });
    expect(wowRosterShapeForSize(undefined)).toEqual({ tank: 1, healer: 1, dps: 3 });
    expect(wowRosterShapeForSize(0, 'raid')).toEqual({ tank: 2, healer: 3, dps: 5 });
  });
  it('always sums to the size for sizes above 5', () => {
    for (const size of [6, 8, 10, 12, 15, 20, 25, 30, 40]) {
      const s = wowRosterShapeForSize(size, 'raid');
      expect(s.tank + s.healer + s.dps).toBe(size);
    }
  });
});
