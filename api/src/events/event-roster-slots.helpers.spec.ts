/**
 * ROK-1606 — every lock-in path gets a roster to sign into.
 *
 * The bug this pins: a `CreateEventDto` with neither `slotConfig` nor
 * `maxAttendees` produces an event with no player slot, so `SignupsService`
 * leaves every signup unrostered.
 */
import type { CreateEventDto } from '@raid-ledger/contract';
import {
  DEFAULT_ROSTER_SLOT_CONFIG,
  withDefaultRosterSlots,
} from './event-roster-slots.helpers';

const BASE: CreateEventDto = {
  title: 'Valheim',
  startTime: '2026-10-10T21:00:00.000Z',
  endTime: '2026-10-10T23:00:00.000Z',
  gameId: 4,
};

describe('withDefaultRosterSlots', () => {
  it('adds the form default (10 player slots) when the caller named none', () => {
    expect(withDefaultRosterSlots(BASE)).toEqual({
      ...BASE,
      slotConfig: { type: 'generic', player: 10 },
    });
    expect(DEFAULT_ROSTER_SLOT_CONFIG).toEqual({ type: 'generic', player: 10 });
  });

  it("keeps the caller's own slotConfig", () => {
    const dto: CreateEventDto = {
      ...BASE,
      slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
    };
    expect(withDefaultRosterSlots(dto)).toBe(dto);
  });

  it('keeps a maxAttendees-only event uncapped by a slot config', () => {
    const dto: CreateEventDto = { ...BASE, maxAttendees: 4 };
    expect(withDefaultRosterSlots(dto)).toBe(dto);
  });

  it('does not mutate the dto it is given', () => {
    const dto: CreateEventDto = { ...BASE };
    withDefaultRosterSlots(dto);
    expect(dto.slotConfig).toBeUndefined();
  });
});
