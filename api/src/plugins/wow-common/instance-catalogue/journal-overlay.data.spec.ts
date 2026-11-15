/**
 * ROK-2210 lane 1a: the overlay is a verbatim move of the old name-keyed
 * tables. The parity block compares against `blizzard-instance-data.ts`,
 * which lane 1b deletes — 1b drops that block with the file.
 */
import {
  CLASSIC_INSTANCE_LEVELS,
  INSTANCE_SHORT_NAMES,
} from '../blizzard-instance-data';
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

  it('matches the old tables entry for entry (parity until lane 1b)', () => {
    const { shortNames, levels } = journalOverlayNames();
    expect(shortNames).toEqual(Object.keys(INSTANCE_SHORT_NAMES));
    expect(levels).toEqual(Object.keys(CLASSIC_INSTANCE_LEVELS));
    for (const [name, short] of Object.entries(INSTANCE_SHORT_NAMES)) {
      expect([name, journalShortName(name)]).toEqual([name, short]);
    }
    for (const [name, range] of Object.entries(CLASSIC_INSTANCE_LEVELS)) {
      expect([name, journalLevelOverlay(name)]).toEqual([name, range]);
    }
  });
});
