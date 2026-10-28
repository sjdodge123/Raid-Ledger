/**
 * ROK-1919 AC3 — the pure half of ding logging. The DB-backed write (same
 * transaction, idempotent re-apply, stale/first import) is proven in
 * `addon-import-guild-dings.integration.spec.ts`.
 */
import { levelUps, type PriorLevel } from './addon-import-guild.dings';
import { buildMember } from './testing/addon-fixture.builder';

const prior = (id: number, level: number | null): PriorLevel => ({
  id,
  guid: buildMember(id).guid,
  level,
});

describe('levelUps', () => {
  it('logs a single-level rise from the stored level', () => {
    const members = [buildMember(1, { level: 39 })];
    expect(levelUps([prior(1, 38)], members)).toEqual([
      { guildMemberId: 1, fromLevel: 38, toLevel: 39 },
    ]);
  });

  it('logs a multi-level jump as ONE event (D3)', () => {
    const members = [buildMember(1, { level: 41 })];
    expect(levelUps([prior(1, 38)], members)).toEqual([
      { guildMemberId: 1, fromLevel: 38, toLevel: 41 },
    ]);
  });

  it.each([
    ['unchanged', 40, 40],
    ['lowered', 40, 39],
  ])('logs nothing when the level is %s', (_label, before, after) => {
    const members = [buildMember(1, { level: after })];
    expect(levelUps([prior(1, before)], members)).toEqual([]);
  });

  it('logs nothing for a newly-joined member (no prior row)', () => {
    expect(levelUps([], [buildMember(7, { level: 20 })])).toEqual([]);
  });

  it('logs nothing when the stored level is null (no baseline)', () => {
    const members = [buildMember(1, { level: 20 })];
    expect(levelUps([prior(1, null)], members)).toEqual([]);
  });

  it('matches by guid, keeping the stored row id', () => {
    const members = [
      buildMember(2, { level: 12 }),
      buildMember(3, { level: 30 }),
    ];
    const stored = [
      { ...prior(2, 10), id: 902 },
      { ...prior(3, 30), id: 903 },
    ];
    expect(levelUps(stored, members)).toEqual([
      { guildMemberId: 902, fromLevel: 10, toLevel: 12 },
    ]);
  });
});
