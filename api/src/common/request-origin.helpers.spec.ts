/**
 * ROK-1627 — the request origin is built from request headers, so the scheme
 * is constrained: only `http` / `https` may come from `X-Forwarded-Proto`.
 */
import type { Request } from 'express';
import { getRequestOrigin } from './request-origin.helpers';

function req(
  headers: Record<string, string | undefined>,
  protocol = 'http',
): Request {
  return { headers, protocol } as unknown as Request;
}

describe('getRequestOrigin', () => {
  it('uses a forwarded https proto', () => {
    expect(
      getRequestOrigin(
        req({ host: 'raid.example', 'x-forwarded-proto': 'https' }),
      ),
    ).toBe('https://raid.example');
  });

  it('takes the first hop and ignores case', () => {
    expect(
      getRequestOrigin(
        req({ host: 'raid.example', 'x-forwarded-proto': 'HTTPS, http' }),
      ),
    ).toBe('https://raid.example');
  });

  it.each(['javascript:alert(1)', 'data', 'ftp', ' ', 'https:'])(
    'ignores a forwarded proto of %p and falls back to the connection',
    (proto) => {
      expect(
        getRequestOrigin(
          req({ host: 'raid.example', 'x-forwarded-proto': proto }),
        ),
      ).toBe('http://raid.example');
      expect(
        getRequestOrigin(
          req({ host: 'raid.example', 'x-forwarded-proto': proto }, 'https'),
        ),
      ).toBe('https://raid.example');
    },
  );

  it('falls back to the connection protocol with no forwarded header', () => {
    expect(getRequestOrigin(req({ host: 'raid.example' }, 'https'))).toBe(
      'https://raid.example',
    );
  });

  it('never emits a scheme other than http or https', () => {
    expect(getRequestOrigin(req({ host: 'raid.example' }, 'gopher'))).toBe(
      'http://raid.example',
    );
  });
});
