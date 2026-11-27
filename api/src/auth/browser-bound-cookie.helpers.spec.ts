/** ROK-2322: the single scheme check behind every auth cookie's Secure flag. */
import {
  browserBoundCookieAttrs,
  isSecureRequest,
} from './browser-bound-cookie.helpers';

describe('isSecureRequest (ROK-2322)', () => {
  it.each([
    ['an HTTPS request', { secure: true }, true],
    ['a plain HTTP request', { secure: false }, false],
    ['no request at all', undefined, false],
  ])('%s → %s', (_label, req, want) => {
    expect(isSecureRequest(req)).toBe(want);
    expect(browserBoundCookieAttrs(req)).toMatchObject({ secure: want });
  });
});
