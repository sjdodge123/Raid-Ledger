import { createHash } from 'node:crypto';
import {
  COMPANION_DEVICE_TOKEN_PATTERN,
  COMPANION_USER_CODE_PATTERN,
} from '@raid-ledger/contract';
import {
  coarseIp,
  companionDeviceTokens,
  deviceCodes,
  formatUserCode,
  generateUserCode,
  hashUserCode,
  parseUserCode,
} from './companion-device-token.helpers';

describe('companion device token helpers', () => {
  it('mints rlcd_ tokens matching the contract pattern, all distinct', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const token = companionDeviceTokens.generate();
      expect(token).toMatch(COMPANION_DEVICE_TOKEN_PATTERN);
      seen.add(token);
    }
    expect(seen.size).toBe(1000);
  });

  it('hashes a token as sha256 hex and refuses the wrong prefix', () => {
    const token = companionDeviceTokens.generate();
    const expected = createHash('sha256').update(token, 'utf8').digest('hex');
    expect(companionDeviceTokens.hash(token)).toBe(expected);
    const rlvl = `rlvl_${token.slice(5)}`;
    expect(companionDeviceTokens.verify(rlvl, expected)).toBe(false);
  });

  it('device codes are 43 base64url chars with no prefix', () => {
    const code = deviceCodes.generate();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deviceCodes.isToken(`${code}x`)).toBe(false);
  });

  it('user codes use only the base-20 alphabet', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(generateUserCode()).toMatch(COMPANION_USER_CODE_PATTERN);
    }
  });

  it('parses typed input to the normalised code, or null', () => {
    expect(parseUserCode(' bcdf-ghjk ')).toBe('BCDFGHJK');
    expect(parseUserCode('BCDA-GHJK')).toBeNull();
    expect(parseUserCode('BCD1-GHJK')).toBeNull();
    expect(parseUserCode('BCDF-GHJ')).toBeNull();
  });

  it('formats XXXX-XXXX and hashes the normalised value', () => {
    expect(formatUserCode('BCDFGHJK')).toBe('BCDF-GHJK');
    const expected = createHash('sha256').update('BCDFGHJK').digest('hex');
    expect(hashUserCode('BCDFGHJK')).toBe(expected);
  });

  it.each([
    ['203.0.113.77', '203.0.113.x'],
    ['::ffff:203.0.113.77', '203.0.113.x'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:0db8:00ab::', '2001:db8:ab::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::1%eth0', 'fe80:0:0::/48'],
  ])('coarseIp(%s) = %s', (ip, expected) => {
    expect(coarseIp(ip)).toBe(expected);
  });

  it('coarseIp returns null for missing or invalid input', () => {
    expect(coarseIp(undefined)).toBeNull();
    expect(coarseIp('not-an-ip')).toBeNull();
  });
});
