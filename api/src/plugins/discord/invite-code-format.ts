/**
 * ROK-1845 — the shape an invite code may take before it is signed into the
 * Discord login state and echoed back to `/auth/success?invite=`. Real codes
 * are 8 chars from `pugs.helpers.ts`'s alphabet; this stays a little wider
 * (letters, digits, `-`, `_`, ≤32) so legacy and test codes keep working,
 * while refusing every URL metacharacter (`/`, `.`, `%`, `?`, `#`).
 */
const INVITE_CODE_FORMAT = /^[A-Za-z0-9_-]{1,32}$/;

export function isInviteCodeFormat(value: unknown): value is string {
  return typeof value === 'string' && INVITE_CODE_FORMAT.test(value);
}
