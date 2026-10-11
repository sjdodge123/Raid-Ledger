/**
 * Unit spec for the private-poll share-link decisions (ROK-1750).
 */
import { BadRequestException } from '@nestjs/common';
import { scrubString } from '../../sentry/sentry-scrub.helpers';
import {
  SHARE_TOKEN_PATTERN,
  assertVisibilityAllowed,
  buildShareSettings,
  canResetShareToken,
  generateShareToken,
  isWellFormedShareToken,
  redeemAddsRows,
  resolveCreateFanout,
  shareFieldsForViewer,
} from './standalone-poll-share.helpers';

describe('generateShareToken', () => {
  it('is 43 base64url characters (256 bits)', () => {
    const token = generateShareToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(isWellFormedShareToken(token)).toBe(true);
  });

  it('is distinct on every call', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateShareToken));
    expect(tokens.size).toBe(50);
  });
});

describe('isWellFormedShareToken', () => {
  it.each([
    ['too short', 'a'.repeat(42)],
    ['too long', 'a'.repeat(44)],
    ['padding char', `${'a'.repeat(42)}=`],
    ['standard base64 char', `${'a'.repeat(42)}+`],
    ['path traversal', `../${'a'.repeat(40)}`],
    ['empty', ''],
  ])('rejects %s', (_label, token) => {
    expect(isWellFormedShareToken(token)).toBe(false);
  });

  it('pattern is anchored', () => {
    expect(SHARE_TOKEN_PATTERN.test(`x${'a'.repeat(43)}`)).toBe(false);
  });
});

describe('assertVisibilityAllowed (R3)', () => {
  it('rejects a private reschedule poll with 400', () => {
    expect(() => assertVisibilityAllowed('private', 7)).toThrow(
      BadRequestException,
    );
  });

  it.each([
    ['public reschedule', 'public' as const, 7],
    ['private standalone', 'private' as const, undefined],
    ['default reschedule', undefined, 7],
  ])('allows %s', (_label, visibility, linkedEventId) => {
    expect(() =>
      assertVisibilityAllowed(visibility, linkedEventId),
    ).not.toThrow();
  });
});

describe('buildShareSettings', () => {
  it('gives a private poll a well-formed token', () => {
    const share = buildShareSettings('private');
    expect(share.visibility).toBe('private');
    expect(isWellFormedShareToken(share.shareToken ?? '')).toBe(true);
  });

  it.each([['public' as const], [undefined]])(
    'keeps %s polls public with no token',
    (visibility) => {
      expect(buildShareSettings(visibility)).toEqual({
        visibility: 'public',
        shareToken: null,
      });
    },
  );
});

describe('resolveCreateFanout (channel gate)', () => {
  it('private: no interest broadcast, no channel card, picked-member DM', () => {
    expect(resolveCreateFanout('private')).toEqual({
      interestBroadcast: false,
      channelEmbed: false,
      pickedMembersDm: true,
    });
  });

  it('public: unchanged broadcast + channel card', () => {
    expect(resolveCreateFanout('public')).toEqual({
      interestBroadcast: true,
      channelEmbed: true,
      pickedMembersDm: false,
    });
  });
});

describe('canResetShareToken (R2)', () => {
  it('allows the creator', () => {
    expect(canResetShareToken(5, false, 5)).toBe(true);
  });

  it('allows an admin/operator who is not the creator', () => {
    expect(canResetShareToken(9, true, 5)).toBe(true);
  });

  it('refuses an invitee', () => {
    expect(canResetShareToken(9, false, 5)).toBe(false);
  });

  it('refuses a non-admin when the creator is gone', () => {
    expect(canResetShareToken(9, false, null)).toBe(false);
  });
});

describe('redeemAddsRows', () => {
  it('adds rows for an ordinary visitor', () => {
    expect(redeemAddsRows(9, false, 5)).toBe(true);
  });

  it('adds nothing for the creator or an admin', () => {
    expect(redeemAddsRows(5, false, 5)).toBe(false);
    expect(redeemAddsRows(9, true, 5)).toBe(false);
  });
});

describe('shareFieldsForViewer', () => {
  const token = 'a'.repeat(43);

  it('private + signed-in viewer → token', () => {
    expect(
      shareFieldsForViewer({ visibility: 'private', shareToken: token }, 3),
    ).toEqual({ visibility: 'private', shareToken: token });
  });

  it('private + anonymous viewer → no token', () => {
    expect(
      shareFieldsForViewer({ visibility: 'private', shareToken: token }, null),
    ).toEqual({ visibility: 'private', shareToken: null });
  });

  it('public poll never exposes a token', () => {
    expect(
      shareFieldsForViewer({ visibility: 'public', shareToken: token }, 3),
    ).toEqual({ visibility: 'public', shareToken: null });
  });
});

describe('Sentry path scrub (spec §3: never leak the token)', () => {
  it('redacts the token from API and web share paths', () => {
    const token = generateShareToken();
    const api = scrubString(`GET /api/scheduling-polls/share/${token}/join`);
    const web = scrubString(`https://x.test/p/poll/${token}`);
    expect(api).toBe('GET /api/scheduling-polls/share/[redacted]/join');
    expect(web).toBe('https://x.test/p/poll/[redacted]');
  });
});
