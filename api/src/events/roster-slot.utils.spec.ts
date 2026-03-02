import { findFirstAvailableSlot } from './roster-slot.utils';

describe('findFirstAvailableSlot', () => {
  describe('null/missing config', () => {
    it('returns null when slotConfig is null', () => {
      expect(findFirstAvailableSlot(null, new Set())).toBeNull();
    });
  });

  describe('MMO events (type: mmo)', () => {
    const mmoConfig = { type: 'mmo', tank: 2, healer: 2, dps: 3 };

    it('returns the first open tank slot', () => {
      const occupied = new Set(['tank:1']);
      expect(findFirstAvailableSlot(mmoConfig, occupied)).toEqual({
        role: 'tank',
        position: 2,
      });
    });

    it('skips full roles and returns the first open slot in a later role', () => {
      const occupied = new Set(['tank:1', 'tank:2', 'healer:1']);
      expect(findFirstAvailableSlot(mmoConfig, occupied)).toEqual({
        role: 'healer',
        position: 2,
      });
    });

    it('returns dps slot when tank and healer are full', () => {
      const occupied = new Set([
        'tank:1',
        'tank:2',
        'healer:1',
        'healer:2',
      ]);
      expect(findFirstAvailableSlot(mmoConfig, occupied)).toEqual({
        role: 'dps',
        position: 1,
      });
    });

    it('returns null when all slots are occupied', () => {
      const occupied = new Set([
        'tank:1',
        'tank:2',
        'healer:1',
        'healer:2',
        'dps:1',
        'dps:2',
        'dps:3',
      ]);
      expect(findFirstAvailableSlot(mmoConfig, occupied)).toBeNull();
    });

    it('returns the first slot when nothing is occupied', () => {
      expect(findFirstAvailableSlot(mmoConfig, new Set())).toEqual({
        role: 'tank',
        position: 1,
      });
    });

    it('handles zero-count roles gracefully', () => {
      const config = { type: 'mmo', tank: 0, healer: 0, dps: 1 };
      expect(findFirstAvailableSlot(config, new Set())).toEqual({
        role: 'dps',
        position: 1,
      });
    });
  });

  describe('generic events (non-MMO)', () => {
    it('returns the first open player slot using "player" key', () => {
      const config = { player: 3 };
      const occupied = new Set(['player:1']);
      expect(findFirstAvailableSlot(config, occupied)).toEqual({
        role: 'player',
        position: 2,
      });
    });

    it('returns the first open player slot using "maxPlayers" key', () => {
      const config = { maxPlayers: 2 };
      expect(findFirstAvailableSlot(config, new Set())).toEqual({
        role: 'player',
        position: 1,
      });
    });

    it('returns the first open player slot using "count" key', () => {
      const config = { count: 2 };
      const occupied = new Set(['player:1']);
      expect(findFirstAvailableSlot(config, occupied)).toEqual({
        role: 'player',
        position: 2,
      });
    });

    it('returns null when all generic slots are occupied', () => {
      const config = { player: 2 };
      const occupied = new Set(['player:1', 'player:2']);
      expect(findFirstAvailableSlot(config, occupied)).toBeNull();
    });

    it('returns null when maxPlayers is 0', () => {
      const config = { maxPlayers: 0 };
      expect(findFirstAvailableSlot(config, new Set())).toBeNull();
    });
  });
});
