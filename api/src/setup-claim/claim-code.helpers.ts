/**
 * ROK-1701: the setup code — generation, normalisation, hashing, timing-safe
 * verification, the 72 h expiry and the OQ-8a arm plan. Pure (no Nest, no
 * db) so bootstrap-admin and the api share it.
 *
 * NEVER log a code or its hash. The plaintext is only ever returned by
 * `generateClaimCode` / `planClaimArm` so bootstrap can print it ONCE.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 10 random bytes = 80 bits = 16 base32 chars. */
export const CLAIM_CODE_BYTES = 10;
/** How long an armed code works (OQ-8a: re-armed on every unclaimed boot). */
export const CLAIM_WINDOW_MS = 72 * 60 * 60 * 1000;
/** A SETUP_CODE shorter than this gets a boot-log warning (never an echo). */
export const SHORT_ENV_CODE_LENGTH = 16;
/** Display shape of a generated code. */
export const CLAIM_CODE_PATTERN = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/;
/** Paste-tolerant shape: dashes optional, any case (D-4). */
const BASE32_SHAPE = /^[A-Z2-7]{4}(-?[A-Z2-7]{4}){3}$/i;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Group a 16-char code as `XXXX-XXXX-XXXX-XXXX`. */
function groupCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join('-') ?? raw;
}

/** A fresh 80-bit code, `XXXX-XXXX-XXXX-XXXX`. `random` is a test seam. */
export function generateClaimCode(
  random: (size: number) => Buffer = randomBytes,
): string {
  return groupCode(base32Encode(random(CLAIM_CODE_BYTES)));
}

/**
 * Trim; a value shaped like a generated code loses its dashes and is
 * upper-cased (pasted with/without dashes, any case). Anything else — e.g. a
 * Render-generated SETUP_CODE — is compared verbatim.
 */
export function normaliseClaimCode(input: string): string {
  const trimmed = input.trim();
  if (!BASE32_SHAPE.test(trimmed)) return trimmed;
  return trimmed.replace(/-/g, '').toUpperCase();
}

/** sha256 hex of the normalised code — the only form ever stored. */
export function hashClaimCode(code: string): string {
  return createHash('sha256')
    .update(normaliseClaimCode(code), 'utf8')
    .digest('hex');
}

/**
 * Constant-time check of a submitted code against the stored hash. A null
 * hash (never armed, or consumed) is always false. The length guard is on the
 * fixed-size digests, never on the raw input.
 */
export function verifyClaimCode(
  candidate: string,
  storedHash: string | null,
): boolean {
  if (storedHash === null || !SHA256_HEX.test(storedHash)) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(hashClaimCode(candidate), 'hex');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** When a code armed at `now` stops working. */
export function claimExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + CLAIM_WINDOW_MS);
}

/** Expired from the expiry instant on (`now == expiresAt` ⇒ expired). */
export function isClaimExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** What a boot should do with the claim (OQ-8a). */
export type ClaimArmPlan =
  | { kind: 'claimed' }
  | { kind: 'env'; codeHash: string; expiresAt: Date; isShort: boolean }
  | { kind: 'generated'; code: string; codeHash: string; expiresAt: Date };

export interface ClaimArmInput {
  /** `claimed_at` from the repository; non-null ⇒ consumed forever. */
  claimedAt: Date | null;
  /** Raw `SETUP_CODE`; blank/undefined ⇒ generate one. */
  envCode: string | undefined;
  now: Date;
  generate?: () => string;
}

/**
 * OQ-8a: consumed ⇒ never re-arm. An env SETUP_CODE re-arms the SAME code
 * with a fresh 72 h window; no env code ⇒ a NEW code every boot (only the
 * newest log line is valid).
 */
export function planClaimArm(input: ClaimArmInput): ClaimArmPlan {
  if (input.claimedAt !== null) return { kind: 'claimed' };
  const expiresAt = claimExpiryFrom(input.now);
  const envCode = input.envCode?.trim() ?? '';
  if (envCode !== '') {
    const isShort = envCode.length < SHORT_ENV_CODE_LENGTH;
    return {
      kind: 'env',
      codeHash: hashClaimCode(envCode),
      expiresAt,
      isShort,
    };
  }
  const code = (input.generate ?? generateClaimCode)();
  return { kind: 'generated', code, codeHash: hashClaimCode(code), expiresAt };
}
