import { findFirstAvailableSlot } from './roster-slot.utils';

const mmoConfig = { type: 'mmo', tank: 2, healer: 2, dps: 3 };

function testReturnsNullWhenSlotConfigIsNull() {
  expect(findFirstAvailableSlot(null, new Set())).toBeNull();
}

function testReturnsFirstOpenTankSlot() {
  const occupied = new Set(['tank:1']);
  expect(findFirstAvailableSlot(mmoConfig, occupied)).toEqual({
    role: 'tank',
    position: 2,
  });
}

function testSkipsFullRoles() {
  const occupied = new Set(['tank:1', 'tank:2', 'healer:1']);
  expect(findFirstAvailableSlot(mmoConfig, occupied)).toEqual({
    role: 'healer',
    position: 2,
  });
}

function testReturnsDpsWhenTankAndHealerFull() {
  const occupied = new Set(['tank:1', 'tank:2', 'healer:1', 'healer:2']);
  expect(findFirstAvailableSlot(mmoConfig, occupied)).toEqual({
    role: 'dps',
    position: 1,
  });
}

function testReturnsNullWhenAllSlotsOccupied() {
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
}

function testReturnsFirstSlotWhenNoneOccupied() {
  expect(findFirstAvailableSlot(mmoConfig, new Set())).toEqual({
    role: 'tank',
    position: 1,
  });
}

function testHandlesZeroCountRoles() {
  const config = { type: 'mmo', tank: 0, healer: 0, dps: 1 };
  expect(findFirstAvailableSlot(config, new Set())).toEqual({
    role: 'dps',
    position: 1,
  });
}

function testGenericPlayerKey() {
  const config = { player: 3 };
  const occupied = new Set(['player:1']);
  expect(findFirstAvailableSlot(config, occupied)).toEqual({
    role: 'player',
    position: 2,
  });
}

function testGenericMaxPlayersKey() {
  const config = { maxPlayers: 2 };
  expect(findFirstAvailableSlot(config, new Set())).toEqual({
    role: 'player',
    position: 1,
  });
}

function testGenericCountKey() {
  const config = { count: 2 };
  const occupied = new Set(['player:1']);
  expect(findFirstAvailableSlot(config, occupied)).toEqual({
    role: 'player',
    position: 2,
  });
}

function testGenericReturnsNullWhenFull() {
  const config = { player: 2 };
  const occupied = new Set(['player:1', 'player:2']);
  expect(findFirstAvailableSlot(config, occupied)).toBeNull();
}

function testGenericReturnsNullWhenMaxPlayersIsZero() {
  const config = { maxPlayers: 0 };
  expect(findFirstAvailableSlot(config, new Set())).toBeNull();
}

describe('findFirstAvailableSlot — null/missing config', () => {
  it('returns null when slotConfig is null', () =>
    testReturnsNullWhenSlotConfigIsNull());
});

describe('findFirstAvailableSlot — MMO events', () => {
  it('returns the first open tank slot', () => testReturnsFirstOpenTankSlot());
  it('skips full roles', () => testSkipsFullRoles());
  it('returns dps slot when tank and healer are full', () =>
    testReturnsDpsWhenTankAndHealerFull());
  it('returns null when all slots are occupied', () =>
    testReturnsNullWhenAllSlotsOccupied());
  it('returns the first slot when nothing is occupied', () =>
    testReturnsFirstSlotWhenNoneOccupied());
  it('handles zero-count roles gracefully', () => testHandlesZeroCountRoles());
});

describe('findFirstAvailableSlot — generic events', () => {
  it('returns the first open player slot using "player" key', () =>
    testGenericPlayerKey());
  it('returns the first open player slot using "maxPlayers" key', () =>
    testGenericMaxPlayersKey());
  it('returns the first open player slot using "count" key', () =>
    testGenericCountKey());
  it('returns null when all generic slots are occupied', () =>
    testGenericReturnsNullWhenFull());
  it('returns null when maxPlayers is 0', () =>
    testGenericReturnsNullWhenMaxPlayersIsZero());
});
