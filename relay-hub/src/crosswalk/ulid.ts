import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LENGTH = 26;

/**
 * Mints a ULID (L3): 48-bit ms timestamp + 80 random bits, Crockford base32,
 * 26 chars. No dependency (RH-2a guard); monotonic within a ms is not needed.
 */
export function mintUlid(now: number = Date.now()): string {
  const random = BigInt('0x' + randomBytes(10).toString('hex'));
  let value = (BigInt(now) << 80n) | random;
  let out = '';
  for (let i = 0; i < ULID_LENGTH; i++) {
    out = CROCKFORD.charAt(Number(value & 31n)) + out;
    value >>= 5n;
  }
  return out;
}
