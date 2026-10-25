import type { CompanionLinkStartResponse } from '@raid-ledger/contract';

/** The approval page path on the web origin (Q10: `/link`). */
export const COMPANION_LINK_PATH = '/link';

/**
 * The RFC 8628 §3.2 start response. `verificationUriComplete` pre-fills the
 * code on the approval page; it never approves by itself (D-10).
 */
export function buildStartResponse(
  webBase: string,
  deviceCode: string,
  userCode: string,
  expiresIn: number,
  interval: number,
): CompanionLinkStartResponse {
  const verificationUri = new URL(COMPANION_LINK_PATH, webBase);
  const complete = new URL(COMPANION_LINK_PATH, webBase);
  complete.searchParams.set('code', userCode);
  return {
    deviceCode,
    userCode,
    verificationUri: verificationUri.toString(),
    verificationUriComplete: complete.toString(),
    expiresIn,
    interval,
  };
}
