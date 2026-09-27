import { describe, it, expect, vi } from 'vitest';
import {
  readMagicLinkToken,
  stripMagicLinkToken,
  takeMagicLinkToken,
} from './magic-link';

describe('ROK-1366: magic-link token carrier is the fragment only', () => {
  it('reads a token from the fragment', () => {
    expect(readMagicLinkToken({ hash: '#token=abc' })).toBe('abc');
  });

  it('never reads a query-string token (that is join-page intent, not a session)', () => {
    const location = { search: '?token=intent', hash: '' };
    expect(readMagicLinkToken(location)).toBeNull();
  });

  it('returns null when the fragment holds no token', () => {
    expect(readMagicLinkToken({ hash: '#section' })).toBeNull();
    expect(readMagicLinkToken({ hash: '' })).toBeNull();
  });

  it('strips the token from the fragment and keeps other params', () => {
    expect(
      stripMagicLinkToken({
        pathname: '/events/42/edit',
        search: '?tab=roster',
        hash: '#token=abc',
      }),
    ).toBe('/events/42/edit?tab=roster');
  });

  it('leaves the query string untouched, including a join-page ?token=', () => {
    expect(
      stripMagicLinkToken({
        pathname: '/join',
        search: '?token=intent&x=1',
        hash: '#token=abc&tab=2',
      }),
    ).toBe('/join?token=intent&x=1#tab=2');
  });

  it('keeps a plain anchor fragment verbatim', () => {
    expect(
      stripMagicLinkToken({ pathname: '/plan', search: '', hash: '#roster' }),
    ).toBe('/plan#roster');
  });
});

describe('ROK-1366: takeMagicLinkToken (module-load strip)', () => {
  function fakeWindow(url: { pathname: string; search: string; hash: string }) {
    return { location: url, history: { replaceState: vi.fn() } };
  }

  it('returns the fragment token and replaces the URL without it', () => {
    const win = fakeWindow({
      pathname: '/events/42',
      search: '?tab=1',
      hash: '#token=abc',
    });
    expect(takeMagicLinkToken(win)).toBe('abc');
    expect(win.history.replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/events/42?tab=1',
    );
  });

  it('does not touch history when only a query token is present', () => {
    const win = fakeWindow({ pathname: '/join', search: '?token=intent', hash: '' });
    expect(takeMagicLinkToken(win)).toBeNull();
    expect(win.history.replaceState).not.toHaveBeenCalled();
  });
});
