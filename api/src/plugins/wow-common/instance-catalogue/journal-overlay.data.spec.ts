/**
 * ROK-2210: the overlay is a verbatim move of the old name-keyed tables
 * (parity was proven in lane 1a against `blizzard-instance-data.ts`).
 */
import { FOREVER_SEED_ID_BASE, allCatalogueRows } from './instance-catalogue';
import {
  journalLevelOverlay,
  journalOverlayNames,
  journalShortName,
} from './journal-overlay.data';

describe('journal overlay', () => {
  it('returns short names and level ranges by journal name', () => {
    expect(journalShortName('Karazhan')).toBe('Kara');
    expect(journalShortName('Not An Instance')).toBe('Not An Instance');
    expect(journalLevelOverlay('Karazhan')).toEqual({
      minimumLevel: 70,
      maximumLevel: 70,
    });
    expect(journalLevelOverlay('Not An Instance')).toBeNull();
  });

  it('returns a copy, not the table entry', () => {
    const first = journalLevelOverlay('Ulduar');
    if (first) first.minimumLevel = 1;
    expect(journalLevelOverlay('Ulduar')?.minimumLevel).toBe(80);
  });
});

/** Ported from the deleted forever-instance-data.spec.ts (ROK-1719). */
describe('Forever-new rows against the journal overlay', () => {
  const seeds = allCatalogueRows().filter((r) => r.id > FOREVER_SEED_ID_BASE);

  it('use short names that collide with no journal short name', () => {
    const taken = new Set(
      journalOverlayNames().shortNames.map((n) => journalShortName(n)),
    );
    const clashes = seeds.filter((r) => taken.has(r.shortName));
    expect(clashes.map((r) => `${r.name} -> ${r.shortName}`)).toEqual([]);
    const own = seeds.map((r) => r.shortName);
    expect(new Set(own).size).toBe(own.length);
  });

  it('keep ids that fit a Postgres integer, clear of synthetic wings', () => {
    expect(seeds).toHaveLength(11);
    for (const { id } of seeds) {
      expect(id).toBeGreaterThan(10000);
      expect(id).toBeLessThanOrEqual(2 ** 31 - 1);
    }
  });

  it('keep the 20-player Hyjal Summit and 10-player Barrow Deeps', () => {
    const players = (name: string) =>
      seeds.find((r) => r.name === name)?.maxPlayers;
    expect([players('Hyjal Summit'), players('Barrow Deeps')]).toEqual([
      20, 10,
    ]);
  });
});
