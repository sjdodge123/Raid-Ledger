import {
  isAtScheduledEventCapacityError,
  tryCreateNewEvent,
  tryDeleteEvent,
  tryEditFullEvent,
} from './scheduled-event.discord-ops';
import { makeDiscordApiError } from './scheduled-event.service.spec-helpers';
import type { ScheduledEventData } from './scheduled-event.helpers';

function makeGuild(deleteImpl: jest.Mock) {
  return {
    scheduledEvents: { delete: deleteImpl },
  } as unknown as Parameters<typeof tryDeleteEvent>[0];
}

/** Guild mock exposing create + edit for the rename payload assertions. */
function makeCreateEditGuild(create: jest.Mock, edit: jest.Mock) {
  return {
    scheduledEvents: { create, edit },
  } as unknown as Parameters<typeof tryCreateNewEvent>[0];
}

function makeEventData(
  overrides: Partial<ScheduledEventData> = {},
): ScheduledEventData {
  return {
    title: 'Gamernight',
    description: null,
    startTime: '2026-06-10T20:00:00.000Z',
    endTime: '2026-06-10T23:00:00.000Z',
    signupCount: 1,
    maxAttendees: 3,
    game: null,
    ...overrides,
  };
}

describe('isAtScheduledEventCapacityError (ROK-1332 AC1)', () => {
  it('returns true for DiscordAPIError with code 30038', () => {
    const err = makeDiscordApiError(
      30038,
      'Max guild scheduled events reached',
    );
    expect(isAtScheduledEventCapacityError(err)).toBe(true);
  });

  it('returns false for DiscordAPIError with a different code (e.g. 10070)', () => {
    const err = makeDiscordApiError(10070, 'Unknown Scheduled Event');
    expect(isAtScheduledEventCapacityError(err)).toBe(false);
  });

  it('returns false for plain Error', () => {
    expect(
      isAtScheduledEventCapacityError(new Error('not a discord error')),
    ).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isAtScheduledEventCapacityError(undefined)).toBe(false);
    expect(isAtScheduledEventCapacityError(null)).toBe(false);
    expect(isAtScheduledEventCapacityError(30038)).toBe(false);
    expect(isAtScheduledEventCapacityError({ code: 30038 })).toBe(false);
  });
});

describe('tryDeleteEvent — outcome (ROK-1347)', () => {
  it('returns { deleted: true } on a successful delete', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const outcome = await tryDeleteEvent(makeGuild(del), 42, 'se-1');
    expect(outcome).toEqual({ deleted: true });
    expect(del).toHaveBeenCalledWith('se-1');
  });

  it('treats 10070 (already gone) as a successful free', async () => {
    const del = jest
      .fn()
      .mockRejectedValue(makeDiscordApiError(10070, 'Unknown Scheduled Event'));
    const outcome = await tryDeleteEvent(makeGuild(del), 42, 'se-1');
    expect(outcome).toEqual({ deleted: true });
  });

  it('returns { deleted: false, code: 50013 } on Missing Permissions', async () => {
    const del = jest
      .fn()
      .mockRejectedValue(makeDiscordApiError(50013, 'Missing Permissions'));
    const outcome = await tryDeleteEvent(makeGuild(del), 42, 'se-1');
    expect(outcome).toEqual({
      deleted: false,
      code: 50013,
      retryAfter: undefined,
    });
  });

  it('returns { deleted: false, code: 429, retryAfter } on rate limit', async () => {
    const err = makeDiscordApiError(429, 'rate limited') as unknown as {
      retryAfter: number;
    };
    err.retryAfter = 3;
    const del = jest.fn().mockRejectedValue(err);
    const outcome = await tryDeleteEvent(makeGuild(del), 42, 'se-1');
    expect(outcome).toEqual({ deleted: false, code: 429, retryAfter: 3 });
  });
});

describe('tryCreateNewEvent — SE name reflects the game (ROK-1350 AC4)', () => {
  it('creates with the bare title when no game is set', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'se-1' });
    const edit = jest.fn();
    await tryCreateNewEvent(
      makeCreateEditGuild(create, edit),
      42,
      makeEventData({ game: null }),
      'voice-1',
      'desc',
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ name: 'Gamernight' });
  });

  it('creates with the combined "<title> — <GAME>" name when a game is set', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'se-1' });
    const edit = jest.fn();
    await tryCreateNewEvent(
      makeCreateEditGuild(create, edit),
      42,
      makeEventData({ game: { name: 'HELLCARD' } }),
      'voice-1',
      'desc',
    );
    expect(create.mock.calls[0][0]).toMatchObject({
      name: 'Gamernight — HELLCARD',
    });
  });
});

describe('tryEditFullEvent — SE name reflects the game (ROK-1350 AC1/AC2)', () => {
  it('edits with the bare title when no game is set (revert path)', async () => {
    const create = jest.fn();
    const edit = jest.fn().mockResolvedValue({ id: 'se-1' });
    await tryEditFullEvent(
      makeCreateEditGuild(create, edit),
      42,
      'se-1',
      makeEventData({ game: null }),
      'desc',
      'voice-1',
    );
    expect(edit).toHaveBeenCalledTimes(1);
    expect(edit.mock.calls[0][0]).toBe('se-1');
    expect(edit.mock.calls[0][1]).toMatchObject({ name: 'Gamernight' });
  });

  it('edits with the combined name when a game is set/changed', async () => {
    const create = jest.fn();
    const edit = jest.fn().mockResolvedValue({ id: 'se-1' });
    await tryEditFullEvent(
      makeCreateEditGuild(create, edit),
      42,
      'se-1',
      makeEventData({ game: { name: 'HELLCARD' } }),
      'desc',
      'voice-1',
    );
    expect(edit.mock.calls[0][1]).toMatchObject({
      name: 'Gamernight — HELLCARD',
    });
  });

  it('does not duplicate the game name when the title already contains it', async () => {
    const create = jest.fn();
    const edit = jest.fn().mockResolvedValue({ id: 'se-1' });
    await tryEditFullEvent(
      makeCreateEditGuild(create, edit),
      42,
      'se-1',
      makeEventData({ title: 'HELLCARD night', game: { name: 'HELLCARD' } }),
      'desc',
      'voice-1',
    );
    expect(edit.mock.calls[0][1]).toMatchObject({ name: 'HELLCARD night' });
  });
});
