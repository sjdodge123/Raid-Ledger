/**
 * ROK-2210: the overlay is a verbatim move of the old name-keyed tables
 * (parity was proven in lane 1a against `blizzard-instance-data.ts`).
 */
import { journalLevelOverlay, journalShortName } from './journal-overlay.data';

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
