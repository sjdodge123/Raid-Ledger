import { isAtScheduledEventCapacityError } from './scheduled-event.discord-ops';
import { makeDiscordApiError } from './scheduled-event.service.spec-helpers';

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
