/**
 * ROK-1830 S5 — request parsing for the onboarding dismissal routes. The key
 * is a CLOSED enum: an unknown prompt must be refused with a 400 rather than
 * written as a row, because the column would otherwise be an open write
 * surface any caller can fill.
 */
import { BadRequestException } from '@nestjs/common';
import {
  assertScopeAllowed,
  fromStorageKey,
  parseOnboardingKey,
  parseOnboardingScope,
  toStorageKey,
} from './hub-onboarding.helpers';

/** The guild id half of a parsed scope (the pre-N4 return value). */
const guildIdOf = (raw: unknown) => parseOnboardingScope(raw).guildId;

describe('parseOnboardingKey', () => {
  it('accepts every known prompt key', () => {
    expect(parseOnboardingKey('players-get-your-guild')).toBe(
      'players-get-your-guild',
    );
    expect(parseOnboardingKey('hub-setup-checklist')).toBe(
      'hub-setup-checklist',
    );
    // ROK-2056 — the hub Overview's Companion prompt, dismissed per hub.
    expect(parseOnboardingKey('companion-install')).toBe('companion-install');
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
    expect(parseOnboardingScope({})).toEqual({ guildId: null, scope: null });
    expect(parseOnboardingScope(undefined)).toEqual({
      guildId: null,
      scope: null,
    });
  });

  it('coerces the query string to a guild id', () => {
    expect(guildIdOf({ guildId: '42' })).toBe(42);
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

  // Codex P2: `2147483648` coerced cleanly and then overflowed Postgres'
  // `integer` column — a 500 on a value the schema should have refused.
  it('refuses a guild id above the int4 ceiling', () => {
    expect(guildIdOf({ guildId: '2147483647' })).toBe(2147483647);
    expect(() => parseOnboardingScope({ guildId: '2147483648' })).toThrow(
      BadRequestException,
    );
  });

  // Codex P3 (PR-3): `Number()` accepts far more than a query string can
  // carry, so three non-canonical spellings resolved to real guild ids.
  it('refuses a guild id that is not canonical decimal digits', () => {
    for (const guildId of ['1e3', ' 7 ', '7.0', '0x10', '+7', '007']) {
      expect(() => parseOnboardingScope({ guildId })).toThrow(
        BadRequestException,
      );
    }
    expect(guildIdOf({ guildId: '7' })).toBe(7);
  });

  // A repeated query param arrives as an array; `Number(['1'])` is 1, so the
  // union has to reject it BEFORE coercion rather than silently accept it.
  it('refuses a non-scalar guildId before coercion', () => {
    expect(() => parseOnboardingScope({ guildId: ['1'] })).toThrow(
      BadRequestException,
    );
    expect(() => parseOnboardingScope({ guildId: { id: 1 } })).toThrow(
      BadRequestException,
    );
  });
});

// ROK-2153 N4 — a claim-character dismissal can be narrowed to a provider
// round (a BG3 campaign). The scope is stored inside the key column.
describe('parseOnboardingScope with scope', () => {
  it('reads a scope alongside its guild id', () => {
    expect(parseOnboardingScope({ guildId: '7', scope: 'campaign-1' })).toEqual(
      { guildId: 7, scope: 'campaign-1' },
    );
  });

  it('refuses a scope without a guild id', () => {
    expect(() => parseOnboardingScope({ scope: 'campaign-1' })).toThrow(
      BadRequestException,
    );
  });

  it('refuses a malformed scope', () => {
    for (const scope of ['a:b', 'a b', '', 'x'.repeat(41)]) {
      expect(() => parseOnboardingScope({ guildId: '7', scope })).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('assertScopeAllowed', () => {
  it('lets claim-character carry a scope', () => {
    expect(() =>
      assertScopeAllowed('claim-character', 'campaign-1'),
    ).not.toThrow();
  });

  it('refuses a scope on any other key', () => {
    expect(() => assertScopeAllowed('companion-install', 'x')).toThrow(
      BadRequestException,
    );
    expect(() => assertScopeAllowed('hub-setup-checklist', 'x')).toThrow(
      BadRequestException,
    );
  });

  it('accepts every key without a scope', () => {
    expect(() => assertScopeAllowed('companion-install', null)).not.toThrow();
  });
});

describe('toStorageKey / fromStorageKey', () => {
  it('leaves an unscoped key unchanged', () => {
    expect(toStorageKey('companion-install', null)).toBe('companion-install');
    expect(fromStorageKey('companion-install')).toEqual({
      key: 'companion-install',
      scope: null,
    });
  });

  it('round-trips a scoped claim-character key', () => {
    const stored = toStorageKey('claim-character', 'campaign-12');
    expect(stored).toBe('claim-character:campaign-12');
    expect(fromStorageKey(stored)).toEqual({
      key: 'claim-character',
      scope: 'campaign-12',
    });
  });

  it('drops a scope on an unscoped key, a bad scope or an unknown base', () => {
    expect(fromStorageKey('companion-install:x')).toBeNull();
    expect(fromStorageKey('claim-character:a b')).toBeNull();
    expect(fromStorageKey('claim-character:')).toBeNull();
    expect(fromStorageKey('retired-prompt')).toBeNull();
    expect(fromStorageKey('retired-prompt:x')).toBeNull();
  });
});
