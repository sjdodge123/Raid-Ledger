/**
 * ROK-1573 — `POST /events` create flow with LFG convert-on-create.
 *
 * The ORDER is the feature: conversion must run before the creator's signup,
 * because the signup listener clears the creator's `active` intent and a
 * cleared creator can no longer convert (spec "Critical verified finding").
 */
import type { CreateEventDto } from '@raid-ledger/contract';
import {
  createEventWithSignups,
  type EventCreateDeps,
} from './event-create-lfg.helpers';

const CREATOR = 7;
const BASE_DTO: CreateEventDto = {
  title: 'Raid',
  startTime: '2026-10-01T18:00:00.000Z',
  endTime: '2026-10-01T20:00:00.000Z',
};

function buildDeps(allEventIds?: number[]) {
  const deps = {
    eventsService: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 100, title: 'Raid', allEventIds }),
    },
    signupsService: { signup: jest.fn().mockResolvedValue({}) },
    lfgEventConvert: { convertForNewEvent: jest.fn().mockResolvedValue([]) },
  };
  return { deps, typed: deps as unknown as EventCreateDeps };
}

describe('createEventWithSignups', () => {
  it('without lfgGameId: signs up the creator and never converts', async () => {
    const { deps, typed } = buildDeps();

    const result = await createEventWithSignups(typed, CREATOR, BASE_DTO);

    expect(result).toEqual({ id: 100, title: 'Raid' });
    expect(deps.lfgEventConvert.convertForNewEvent).not.toHaveBeenCalled();
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
    deps.lfgEventConvert.convertForNewEvent.mockResolvedValue([CREATOR, 8]);

    await createEventWithSignups(typed, CREATOR, {
      ...BASE_DTO,
      gameId: 5,
      lfgGameId: 5,
    });

    expect(deps.lfgEventConvert.convertForNewEvent).toHaveBeenCalledWith(
      CREATOR,
      5,
      100,
    );
    const convertOrder =
      deps.lfgEventConvert.convertForNewEvent.mock.invocationCallOrder[0];
    const firstSignupOrder =
      deps.signupsService.signup.mock.invocationCallOrder[0];
    expect(convertOrder).toBeLessThan(firstSignupOrder);
  });

  it('signs converted members up on the event, skipping the creator', async () => {
    const { deps, typed } = buildDeps();
    deps.lfgEventConvert.convertForNewEvent.mockResolvedValue([CREATOR, 8, 9]);

    await createEventWithSignups(typed, CREATOR, {
      ...BASE_DTO,
      gameId: 5,
      lfgGameId: 5,
    });

    const calls = deps.signupsService.signup.mock.calls.map((c) => c[1]);
    expect(calls).toEqual([CREATOR, 8, 9]);
    expect(deps.signupsService.signup).toHaveBeenCalledWith(100, 8);
  });

  it('recurring: creator on every occurrence, members on occurrence 1 only (Q8)', async () => {
    const { deps, typed } = buildDeps([100, 101, 102]);
    deps.lfgEventConvert.convertForNewEvent.mockResolvedValue([8]);

    const result = await createEventWithSignups(typed, CREATOR, {
      ...BASE_DTO,
      gameId: 5,
      lfgGameId: 5,
    });

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
});
