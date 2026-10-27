/**
 * ROK-1955: shared primitives for prefixed bearer tokens (extracted from the
 * ROK-1833 Valheim Link token). A token is `<prefix>` + 32 CSPRNG bytes as 43
 * base64url chars. Only its sha256 hex hash (the indexed `token_hash` lookup
 * key) and a 4-char hint are ever stored; 256 bits of entropy make a slow
 * KDF pointless and an unsalted hash is what makes the lookup indexable.
 * NEVER log a token, its hash or its hint.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Random bytes per token (→ 43 base64url chars after the prefix). */
export const PREFIXED_TOKEN_BYTES = 32;

/** The operations every prefixed-token family needs. */
export interface PrefixedTokenKit {
  /** A fresh 256-bit token: prefix + 43 base64url chars. */
  generate(): string;
  /** True when `value` has the exact shape `generate` makes. */
  isToken(value: string): boolean;
  /** sha256 of the token as 64 lower-case hex chars (the `token_hash`). */
  hash(token: string): string;
  /** True when `token` is well-formed and hashes to `storedHash`. */
  verify(token: string, storedHash: string): boolean;
  /** Last 4 chars, stored as `token_hint` for "…ab12" display. */
  hintOf(token: string): string;
}

/** Constant-time compare of two hashes; false on any length mismatch. */
export function tokenHashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** sha256 hex of the utf8 string. */
function sha256Hex(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Throw at module load if `pattern` could never gate this prefix's tokens. */
function assertPatternFits(pattern: RegExp, sample: string): void {
  if (pattern.global || pattern.sticky) {
    throw new Error('prefixed-token: pattern must not use the g or y flag');
  }
  if (!pattern.test(sample)) {
    throw new Error('prefixed-token: pattern does not match generated tokens');
  }
}

/**
 * Build the generate / shape-check / hash / verify / hint set for one token
 * family. `pattern` is the anchored shape (usually exported from the
 * contract); it must accept what `generate` makes, checked once here.
 */
export function createPrefixedTokenKit(
  prefix: string,
  pattern: RegExp,
): PrefixedTokenKit {
  const generate = (): string =>
    `${prefix}${randomBytes(PREFIXED_TOKEN_BYTES).toString('base64url')}`;
  assertPatternFits(pattern, generate());
  const isToken = (value: string): boolean => pattern.test(value);
  return {
    generate,
    isToken,
    hash: sha256Hex,
    verify: (token: string, storedHash: string): boolean =>
      isToken(token) && tokenHashesEqual(sha256Hex(token), storedHash),
    hintOf: (token: string): string => token.slice(-4),
  };
}
