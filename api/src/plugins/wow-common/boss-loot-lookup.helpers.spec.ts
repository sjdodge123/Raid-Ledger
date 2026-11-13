/**
 * Boss FK resolution for loot rows. Two bosses can share a name inside one
 * expansion (Kael'thas in Magisters' Terrace and The Eye, Anub'arak in
 * Azjol-Nerub and Trial of the Crusader): a loot row must land on the same
 * boss row on every boot, whatever order the DB returns the boss rows in.
 */
import type { BossKeyRow } from './boss-encounter-prune.helpers';
import { buildBossLookup, resolveLootBossId } from './boss-loot-lookup.helpers';

const MGT: BossKeyRow = {
  id: 11,
  instanceId: 249,
  name: "Kael'thas Sunstrider",
  expansion: 'tbc',
};
const EYE: BossKeyRow = {
  id: 12,
  instanceId: 749,
  name: "Kael'thas Sunstrider",
  expansion: 'tbc',
};
const KAEL = { bossName: "Kael'thas Sunstrider", expansion: 'tbc' };

describe('buildBossLookup / resolveLootBossId — same-name bosses', () => {
  it('resolves to the same boss whatever order the rows arrive in', () => {
    const a = resolveLootBossId(buildBossLookup([MGT, EYE]), KAEL);
    const b = resolveLootBossId(buildBossLookup([EYE, MGT]), KAEL);
    expect(a).toBe(MGT.id);
    expect(b).toBe(MGT.id);
  });

  it('a loot row naming its instance resolves to that instance boss', () => {
    for (const rows of [
      [MGT, EYE],
      [EYE, MGT],
    ]) {
      const lookup = buildBossLookup(rows);
      expect(resolveLootBossId(lookup, { ...KAEL, instanceId: 749 })).toBe(
        EYE.id,
      );
      expect(resolveLootBossId(lookup, { ...KAEL, instanceId: 249 })).toBe(
        MGT.id,
      );
    }
  });

  it('a forever row falls back to the classic boss of the same name', () => {
    const rag: BossKeyRow = {
      id: 1,
      instanceId: 409,
      name: 'Ragnaros',
      expansion: 'classic',
    };
    const lookup = buildBossLookup([rag]);
    expect(
      resolveLootBossId(lookup, { bossName: 'Ragnaros', expansion: 'forever' }),
    ).toBe(rag.id);
  });
});
