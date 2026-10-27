/**
 * ROK-1955: the secrets of the companion device-link flow.
 * - `rlcd_` device token (D-7) — the long-lived ingest bearer.
 * - `device_code` (D-8) — 32 random bytes base64url, NO prefix. It is NOT a
 *   bearer; it is hashed with the same sha256 kit (prefix `''`) so its row
 *   lookup is indexable and a DB read cannot poll someone else's link.
 * - `user_code` (D-8) — 8 chars of the RFC 8628 base-20 alphabet, shown
 *   `XXXX-XXXX`, stored as sha256 hex of the normalised value.
 * Only hashes and coarse networks are stored. NEVER log any of these values.
 */
import { createHash, randomInt } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import {
  COMPANION_DEVICE_TOKEN_PATTERN,
  COMPANION_USER_CODE_ALPHABET,
  COMPANION_USER_CODE_PATTERN,
  normaliseCompanionUserCode,
} from '@raid-ledger/contract';
import {
  createPrefixedTokenKit,
  type PrefixedTokenKit,
} from '../../common/tokens/prefixed-token.helpers';

/** The `rlcd_` device token kit. */
export const companionDeviceTokens: PrefixedTokenKit = createPrefixedTokenKit(
  'rlcd_',
  COMPANION_DEVICE_TOKEN_PATTERN,
);

/** The prefix-less `device_code` kit (same generator + sha256 hash). */
export const deviceCodes: PrefixedTokenKit = createPrefixedTokenKit(
  '',
  /^[A-Za-z0-9_-]{43}$/,
);

const USER_CODE_LENGTH = 8;

/** A fresh normalised 8-char user code (uniform over the alphabet). */
export function generateUserCode(): string {
  let code = '';
  for (let i = 0; i < USER_CODE_LENGTH; i += 1) {
    code += COMPANION_USER_CODE_ALPHABET[randomInt(20)] ?? '';
  }
  return code;
}

/** Typed input → normalised code, or null when it is not a valid code. */
export function parseUserCode(input: string): string | null {
  const code = normaliseCompanionUserCode(input);
  return COMPANION_USER_CODE_PATTERN.test(code) ? code : null;
}

/** Normalised `BCDFGHJK` → displayed `BCDF-GHJK`. */
export function formatUserCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** sha256 hex of a normalised user code (the `user_code_hash`). */
export function hashUserCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

/** The eight 16-bit groups of an IPv6 address (no zone, no v4 tail). */
function ipv6Groups(ip: string): string[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  return groups.length === 8 ? groups : null;
}

/**
 * The coarse network of an address: IPv4 /24 as `203.0.113.x`, IPv6 /48 as
 * `2001:db8:abcd::/48` (IPv4-mapped IPv6 is treated as IPv4). null when the
 * input is missing or not an IP. The full address is never stored (D-11).
 */
export function coarseIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const bare = ip.split('%')[0] ?? '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)?.[1];
  const v4 = mapped ?? bare;
  if (isIPv4(v4)) return `${v4.split('.').slice(0, 3).join('.')}.x`;
  if (!isIPv6(bare)) return null;
  const groups = ipv6Groups(bare.toLowerCase());
  if (!groups) return null;
  const top = groups.slice(0, 3).map((g) => parseInt(g, 16).toString(16));
  return `${top.join(':')}::/48`;
}
