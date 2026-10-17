/**
 * ROK-1830 S5 — request parsing for the onboarding dismissal routes. The key
 * is a CLOSED enum: an unknown prompt must be refused with a 400 rather than
 * written as a row, because the column would otherwise be an open write
 * surface any caller can fill.
 */
import { BadRequestException } from '@nestjs/common';
import {
  parseOnboardingKey,
  parseOnboardingScope,
} from './hub-onboarding.helpers';

describe('parseOnboardingKey', () => {
  it('accepts every known prompt key', () => {
    expect(parseOnboardingKey('players-get-your-guild')).toBe(
      'players-get-your-guild',
    );
    expect(parseOnboardingKey('hub-setup-checklist')).toBe(
      'hub-setup-checklist',
    );
  });

  it('refuses an unknown key with a 400, not a stored row', () => {
    expect(() => parseOnboardingKey('whatever-i-like')).toThrow(
      BadRequestException,
    );
  });

  it('refuses a non-string key', () => {
    expect(() => parseOnboardingKey(7)).toThrow(BadRequestException);
    expect(() => parseOnboardingKey(undefined)).toThrow(BadRequestException);
  });
});

describe('parseOnboardingScope', () => {
  it('reads no guildId as the global scope', () => {
    expect(parseOnboardingScope({})).toBeNull();
    expect(parseOnboardingScope(undefined)).toBeNull();
  });

  it('coerces the query string to a guild id', () => {
    expect(parseOnboardingScope({ guildId: '42' })).toBe(42);
  });

  it('refuses a non-numeric, zero or unknown query key', () => {
    expect(() => parseOnboardingScope({ guildId: 'abc' })).toThrow(
      BadRequestException,
    );
    expect(() => parseOnboardingScope({ guildId: '0' })).toThrow(
      BadRequestException,
    );
    expect(() => parseOnboardingScope({ userId: '1' })).toThrow(
      BadRequestException,
    );
  });
});
