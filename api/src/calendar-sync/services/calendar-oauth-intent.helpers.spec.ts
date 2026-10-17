import { BadRequestException } from '@nestjs/common';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { at } from '../../common/testing/narrow';
import {
  GOOGLE_EVENTS_SCOPE,
  GOOGLE_READ_SCOPES,
} from '../providers/google/google-oauth.helpers';
import {
  applyConsentIntent,
  grantCoversIntent,
  parseOAuthIntentQuery,
} from './calendar-oauth-intent.helpers';

describe('parseOAuthIntentQuery (ROK-1596 D8)', () => {
  it('absent → connect', () => {
    expect(parseOAuthIntentQuery(undefined)).toBe('connect');
  });

  it('passes connect, primary and read through', () => {
    expect(parseOAuthIntentQuery('connect')).toBe('connect');
    expect(parseOAuthIntentQuery('primary')).toBe('primary');
    expect(parseOAuthIntentQuery('read')).toBe('read');
  });

  it.each(['bogus', '', ['primary']])('rejects %p with a 400', (raw) => {
    expect(() => parseOAuthIntentQuery(raw)).toThrow(BadRequestException);
  });
});

describe('grantCoversIntent (ROK-1596 D8)', () => {
  const connectSet = ['openid', 'email'];

  it('connect never needs the events scope', () => {
    expect(grantCoversIntent('connect', 'google', connectSet)).toBe(true);
  });

  it('primary needs calendar.events in the grant', () => {
    expect(grantCoversIntent('primary', 'google', connectSet)).toBe(false);
    expect(
      grantCoversIntent('primary', 'google', [
        ...connectSet,
        GOOGLE_EVENTS_SCOPE,
      ]),
    ).toBe(true);
  });

  it('primary is Google-only for now', () => {
    expect(
      grantCoversIntent('primary', 'microsoft', [GOOGLE_EVENTS_SCOPE]),
    ).toBe(false);
  });
});

describe('read consent (ROK-1593 D-R3)', () => {
  const connectSet = ['openid', 'email'];

  it('grantCoversIntent(read) needs the read scopes, Google-only', () => {
    expect(grantCoversIntent('read', 'google', connectSet)).toBe(false);
    expect(grantCoversIntent('read', 'google', [GOOGLE_EVENTS_SCOPE])).toBe(
      false,
    );
    expect(grantCoversIntent('read', 'google', [...GOOGLE_READ_SCOPES])).toBe(
      true,
    );
    expect(
      grantCoversIntent('read', 'microsoft', [...GOOGLE_READ_SCOPES]),
    ).toBe(false);
  });

  it('§1.1 regression: a read grant WITHOUT calendar.events writes only the read flags', async () => {
    const db = createDrizzleMock();
    // A write_target UPDATE (the m1 fall-back) would resolve here, so a
    // bypassed read branch fails on the assertions below, not on the mock.
    db.returning.mockResolvedValue([{ writeEnabled: false }]);
    const queue = { add: jest.fn(), getJob: jest.fn() };
    const out = await applyConsentIntent(db as never, {
      intent: 'read',
      connectionId: 5,
      userId: 3,
      provider: 'google',
      grantedScopes: [...connectSet, ...GOOGLE_READ_SCOPES],
      queue: queue as never,
    });
    const set = at(db.set.mock.calls, 0)[0] as Record<string, unknown>;
    expect(Object.keys(set).sort()).toEqual([
      'readAccessGranted',
      'readEnabled',
      'updatedAt',
    ]);
    expect(set).toMatchObject({ readAccessGranted: true, readEnabled: true });
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(out).toBe('read');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
