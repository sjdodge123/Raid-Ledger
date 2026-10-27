import { BadRequestException } from '@nestjs/common';
import {
  CALENDARS_PAGE_PATH,
  ONBOARDING_RESUME_PATH,
  callbackLocation,
  parseOAuthReturnQuery,
} from './calendar-oauth-return.helpers';

const BASE = 'https://raid.example.test';

describe('parseOAuthReturnQuery (ROK-2022)', () => {
  it('absent → undefined (the legacy Integrations landing)', () => {
    expect(parseOAuthReturnQuery(undefined)).toBeUndefined();
  });

  it('onboarding → onboarding', () => {
    expect(parseOAuthReturnQuery('onboarding')).toBe('onboarding');
  });

  it.each([['evil'], ['/onboarding'], ['https://evil.test'], [['onboarding']]])(
    'unknown value %p → 400 invalid_return',
    (raw) => {
      expect(() => parseOAuthReturnQuery(raw)).toThrow(BadRequestException);
      expect(() => parseOAuthReturnQuery(raw)).toThrow('invalid_return');
    },
  );
});

describe('callbackLocation (ROK-2022)', () => {
  it('no target + connected → Integrations ?connected=<provider>', () => {
    expect(callbackLocation(BASE, 'google', { outcome: 'connected' })).toBe(
      `${BASE}${CALENDARS_PAGE_PATH}?connected=google`,
    );
  });

  it('no target + error → Integrations ?error=<code>', () => {
    expect(callbackLocation(`${BASE}/`, 'google', { outcome: 'state' })).toBe(
      `${BASE}/profile/integrations?error=state`,
    );
  });

  it('onboarding + connected → the wizard resume at the Calendar step', () => {
    expect(
      callbackLocation(BASE, 'google', {
        outcome: 'connected',
        returnTarget: 'onboarding',
      }),
    ).toBe(`${BASE}/onboarding?resume=calendar&connected=google`);
  });

  it('onboarding + error → the wizard resume with the error code', () => {
    expect(
      callbackLocation(BASE, 'google', {
        outcome: 'denied',
        returnTarget: 'onboarding',
      }),
    ).toBe(`${BASE}${ONBOARDING_RESUME_PATH}&error=denied`);
  });

  it('strips every trailing slash from the client URL', () => {
    expect(
      callbackLocation(`${BASE}///`, 'google', {
        outcome: 'connected',
        returnTarget: 'onboarding',
      }),
    ).toBe(`${BASE}/onboarding?resume=calendar&connected=google`);
  });
});
