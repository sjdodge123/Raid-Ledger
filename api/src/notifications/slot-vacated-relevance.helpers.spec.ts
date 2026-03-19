import {
  isSlotVacatedRelevant,
  resolveEventCapacity,
} from './slot-vacated-relevance.helpers';

describe('resolveEventCapacity', () => {
  it('returns total non-bench slots for MMO slotConfig', () => {
    const event = {
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
      maxAttendees: null,
    };
    expect(resolveEventCapacity(event as never)).toBe(5);
  });

  it('returns player count for generic slotConfig', () => {
    const event = {
      slotConfig: { type: 'generic', player: 8 },
      maxAttendees: null,
    };
    expect(resolveEventCapacity(event as never)).toBe(8);
  });

  it('returns maxAttendees when no slotConfig', () => {
    const event = { slotConfig: null, maxAttendees: 10 };
    expect(resolveEventCapacity(event as never)).toBe(10);
  });

  it('returns null when no slotConfig and no maxAttendees', () => {
    const event = { slotConfig: null, maxAttendees: null };
    expect(resolveEventCapacity(event as never)).toBeNull();
  });
});

describe('isSlotVacatedRelevant', () => {
  it('returns true for MMO tank departure', () => {
    const event = {
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
      maxAttendees: null,
    };
    expect(isSlotVacatedRelevant(event as never, 'tank', 0)).toBe(true);
  });

  it('returns true for MMO healer departure', () => {
    const event = {
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
      maxAttendees: null,
    };
    expect(isSlotVacatedRelevant(event as never, 'healer', 0)).toBe(true);
  });

  it('returns false for MMO dps departure', () => {
    const event = {
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
      maxAttendees: null,
    };
    expect(isSlotVacatedRelevant(event as never, 'dps', 0)).toBe(false);
  });

  it('returns false for MMO flex departure', () => {
    const event = {
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 1 },
      maxAttendees: null,
    };
    expect(isSlotVacatedRelevant(event as never, 'flex', 0)).toBe(false);
  });

  it('returns false for MMO player departure (generic role on MMO)', () => {
    const event = {
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
      maxAttendees: null,
    };
    expect(isSlotVacatedRelevant(event as never, 'player', 0)).toBe(false);
  });

  it('returns true for generic event at capacity', () => {
    const event = {
      slotConfig: { type: 'generic', player: 6 },
      maxAttendees: null,
    };
    // activeSignups=5, +1 for departed = 6 = capacity
    expect(isSlotVacatedRelevant(event as never, 'player', 5)).toBe(true);
  });

  it('returns false for generic event not full', () => {
    const event = {
      slotConfig: { type: 'generic', player: 10 },
      maxAttendees: null,
    };
    // activeSignups=3, +1 for departed = 4 < 10
    expect(isSlotVacatedRelevant(event as never, 'player', 3)).toBe(false);
  });

  it('returns true for no-config event with maxAttendees at capacity', () => {
    const event = {
      slotConfig: null,
      maxAttendees: 5,
    };
    // activeSignups=4, +1 for departed = 5 = capacity
    expect(isSlotVacatedRelevant(event as never, 'player', 4)).toBe(true);
  });

  it('returns false for no-config event with maxAttendees below capacity', () => {
    const event = {
      slotConfig: null,
      maxAttendees: 10,
    };
    // activeSignups=3, +1=4 < 10
    expect(isSlotVacatedRelevant(event as never, 'player', 3)).toBe(false);
  });

  it('returns false for no-config no-cap event', () => {
    const event = {
      slotConfig: null,
      maxAttendees: null,
    };
    expect(isSlotVacatedRelevant(event as never, 'player', 5)).toBe(false);
  });
});
