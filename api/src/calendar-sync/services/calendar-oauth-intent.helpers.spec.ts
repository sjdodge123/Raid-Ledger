import { BadRequestException } from '@nestjs/common';
import { GOOGLE_EVENTS_SCOPE } from '../providers/google/google-oauth.helpers';
import {
  grantCoversIntent,
  parseOAuthIntentQuery,
} from './calendar-oauth-intent.helpers';

describe('parseOAuthIntentQuery (ROK-1596 D8)', () => {
  it('absent → connect', () => {
    expect(parseOAuthIntentQuery(undefined)).toBe('connect');
  });

  it('passes connect and primary through', () => {
    expect(parseOAuthIntentQuery('connect')).toBe('connect');
    expect(parseOAuthIntentQuery('primary')).toBe('primary');
  });

  it.each(['read', '', ['primary']])('rejects %p with a 400', (raw) => {
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
