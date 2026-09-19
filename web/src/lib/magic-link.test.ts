import { describe, it, expect } from 'vitest';
import {
  readMagicLinkToken,
  hasMagicLinkToken,
  stripMagicLinkToken,
} from './magic-link';

describe('ROK-1366: magic-link token carriers', () => {
  it('reads a token from the fragment', () => {
    expect(readMagicLinkToken({ search: '', hash: '#token=abc' })).toBe('abc');
  });

  it('still reads a legacy token from the query string', () => {
    expect(readMagicLinkToken({ search: '?token=legacy', hash: '' })).toBe(
      'legacy',
    );
  });

  it('prefers the fragment when both carriers are present', () => {
    expect(
      readMagicLinkToken({ search: '?token=old', hash: '#token=new' }),
    ).toBe('new');
  });

  it('returns null when neither carrier holds a token', () => {
    expect(readMagicLinkToken({ search: '?tab=1', hash: '#section' })).toBeNull();
    expect(hasMagicLinkToken({ search: '', hash: '' })).toBe(false);
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

  it('strips a legacy query token and keeps an unrelated fragment', () => {
    expect(
      stripMagicLinkToken({
        pathname: '/plan',
        search: '?token=legacy&tab=1',
        hash: '#anchor',
      }),
    ).toBe('/plan?tab=1#anchor');
  });
});
