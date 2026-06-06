import {
  isAtScheduledEventCapacityError,
  tryDeleteEvent,
} from './scheduled-event.discord-ops';
import { makeDiscordApiError } from './scheduled-event.service.spec-helpers';

function makeGuild(deleteImpl: jest.Mock) {
  return {
    scheduledEvents: { delete: deleteImpl },
  } as unknown as Parameters<typeof tryDeleteEvent>[0];
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
