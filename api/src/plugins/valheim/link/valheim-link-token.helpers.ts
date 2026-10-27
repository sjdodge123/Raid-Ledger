/**
 * ROK-1833: the per-server Valheim Link ingest token (calendar-feed precedent,
 * ROK-1599). `rlvl_` + 32 random bytes as 43 base64url chars. Only the sha256
 * hex hash and the last 4 chars are stored; the plaintext is returned once.
 * NEVER log a token, its hash or its hint — log the pelican server id.
 *
 * ROK-1955: thin wrappers over the shared `rlvl_` prefixed-token kit; the
 * exported names and behaviour are unchanged.
 */
import { VALHEIM_LINK_TOKEN_PATTERN } from '@raid-ledger/contract';
import {
  createPrefixedTokenKit,
  tokenHashesEqual,
} from '../../../common/tokens/prefixed-token.helpers';

export { VALHEIM_LINK_TOKEN_PATTERN, tokenHashesEqual };

const TOKEN_PREFIX = 'rlvl_';
const kit = createPrefixedTokenKit(TOKEN_PREFIX, VALHEIM_LINK_TOKEN_PATTERN);

/** A fresh 256-bit ingest token. */
export function generateValheimLinkToken(): string {
  return kit.generate();
}

/** True when `value` has the exact shape `generateValheimLinkToken` makes. */
export function isValheimLinkToken(value: string): boolean {
  return kit.isToken(value);
}

/** sha256 of the token as 64 lower-case hex chars (the `token_hash`). */
export function hashValheimLinkToken(token: string): string {
  return kit.hash(token);
}

/** True when `token` is well-formed and hashes to `storedHash`. */
export function verifyValheimLinkToken(
  token: string,
  storedHash: string,
): boolean {
  return kit.verify(token, storedHash);
}

/** Last 4 chars, stored as `token_hint` for "…ab12" display. */
export function tokenHintOf(token: string): string {
  return kit.hintOf(token);
}
