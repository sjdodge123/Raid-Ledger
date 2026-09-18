/**
 * ROK-1573 — `POST /events` create flow with LFG convert-on-create.
 *
 * The ORDER is the feature: conversion must run before the creator's signup,
 * because the signup listener clears the creator's `active` intent and a
 * cleared creator can no longer convert (spec "Critical verified finding").
 */
import { ConflictException } from '@nestjs/common';
import type { CreateEventDto } from '@raid-ledger/contract';
import {
  createEventWithSignups,
  withLfgRosterSlots,
  type EventCreateDeps,
} from './event-create-lfg.helpers';
import { DEFAULT_ROSTER_SLOT_CONFIG } from './event-roster-slots.helpers';

const CREATOR = 7;
const BASE_DTO: CreateEventDto = {
  title: 'Raid',
  startTime: '2026-10-01T18:00:00.000Z',
  endTime: '2026-10-01T20:00:00.000Z',
};

const LFG_DTO: CreateEventDto = { ...BASE_DTO, gameId: 5, lfgGameId: 5 };

function buildDeps(allEventIds?: number[]) {
  const deps = {
    eventsService: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 100, title: 'Raid', allEventIds }),
    },
    signupsService: { signup: jest.fn().mockResolvedValue({}) },
    lfgEventConvert: { createForGroup: jest.fn() },
  };
  return { deps, typed: deps as unknown as EventCreateDeps };
}

/** The real service creates inside the group lock, then converts. */
function convertsTo(deps: ReturnType<typeof buildDeps>['deps'], ids: number[]) {
  deps.lfgEventConvert.createForGroup.mockImplementation(
    async (_u: number, _g: number, create: () => Promise<{ id: number }>) => ({
      event: await create(),
      memberIds: ids,
    }),
  );
}

describe('createEventWithSignups', () => {
  it('without lfgGameId: signs up the creator and never converts', async () => {
    const { deps, typed } = buildDeps();

    const result = await createEventWithSignups(typed, CREATOR, BASE_DTO);

    expect(result).toEqual({ id: 100, title: 'Raid' });
    expect(deps.eventsService.create).toHaveBeenCalledWith(CREATOR, BASE_DTO);
    expect(deps.lfgEventConvert.createForGroup).not.toHaveBeenCalled();
    expect(deps.signupsService.signup).toHaveBeenCalledTimes(1);
    expect(deps.signupsService.signup).toHaveBeenCalledWith(
      100,
      CREATOR,
      undefined,
      { skipEndedCheck: true },
    );
  });

  it('converts the LFG group BEFORE the creator signup', async () => {
    const { deps, typed } = buildDeps();
    convertsTo(deps, [CREATOR, 8]);

    await createEventWithSignups(typed, CREATOR, LFG_DTO);

    expect(deps.lfgEventConvert.createForGroup).toHaveBeenCalledWith(
      CREATOR,
      5,
      expect.any(Function),
    );
    expect(deps.eventsService.create).toHaveBeenCalledWith(CREATOR, {
      ...LFG_DTO,
      slotConfig: DEFAULT_ROSTER_SLOT_CONFIG,
    });
    const convertOrder =
      deps.lfgEventConvert.createForGroup.mock.invocationCallOrder[0];
    const firstSignupOrder =
      deps.signupsService.signup.mock.invocationCallOrder[0];
    expect(convertOrder).toBeLessThan(firstSignupOrder);
  });

  it('signs converted members up on the event, skipping the creator', async () => {
    const { deps, typed } = buildDeps();
    convertsTo(deps, [CREATOR, 8, 9]);

    await createEventWithSignups(typed, CREATOR, LFG_DTO);

    const calls = deps.signupsService.signup.mock.calls.map((c) => c[1]);
    expect(calls).toEqual([CREATOR, 8, 9]);
    expect(deps.signupsService.signup).toHaveBeenCalledWith(100, 8);
  });

  it('recurring: creator on every occurrence, members on occurrence 1 only (Q8)', async () => {
    const { deps, typed } = buildDeps([100, 101, 102]);
    convertsTo(deps, [8]);

    const result = await createEventWithSignups(typed, CREATOR, LFG_DTO);

    expect(result).not.toHaveProperty('allEventIds');
    const pairs = deps.signupsService.signup.mock.calls.map((c) => [
      c[0],
      c[1],
    ]);
    expect(pairs).toEqual([
      [100, CREATOR],
      [101, CREATOR],
      [102, CREATOR],
      [100, 8],
    ]);
  });

  it('409 (group gone): propagates the conflict and signs nobody up', async () => {
    const { deps, typed } = buildDeps();
    deps.lfgEventConvert.createForGroup.mockRejectedValue(
      new ConflictException(
        'This group was already scheduled or you are no longer in it.',
      ),
    );

    await expect(
      createEventWithSignups(typed, CREATOR, LFG_DTO),
    ).rejects.toMatchObject({ status: 409 });
    expect(deps.eventsService.create).not.toHaveBeenCalled();
    expect(deps.signupsService.signup).not.toHaveBeenCalled();
  });
});

describe('withLfgRosterSlots', () => {
  it('gives a Lock-in with no roster the generic player slots', () => {
    expect(withLfgRosterSlots(LFG_DTO)).toEqual({
      ...LFG_DTO,
      slotConfig: { type: 'generic', player: 10 },
    });
  });

  it('keeps a body-provided slotConfig or maxAttendees', () => {
    const mmo: CreateEventDto = {
      ...LFG_DTO,
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3 },
    };
    const capped: CreateEventDto = { ...LFG_DTO, maxAttendees: 4 };
    expect(withLfgRosterSlots(mmo)).toBe(mmo);
    expect(withLfgRosterSlots(capped)).toBe(capped);
  });

  it('leaves a plain (non-LFG) create alone', () => {
    expect(withLfgRosterSlots(BASE_DTO)).toBe(BASE_DTO);
  });
});
