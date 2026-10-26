import type { CompanionLinkStartResponse } from '@raid-ledger/contract';

/** The approval page path on the web origin (Q10: `/link`). */
export const COMPANION_LINK_PATH = '/link';

/**
 * The RFC 8628 §3.2 start response. `verificationUriComplete` pre-fills the
 * code on the approval page; it never approves by itself (D-10). The code
 * rides in the fragment (`/link#code=…`), which browsers never send to the
 * server — so it stays out of access logs and Referer headers (Codex P2).
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
  complete.hash = new URLSearchParams({ code: userCode }).toString();
  return {
    deviceCode,
    userCode,
    verificationUri: verificationUri.toString(),
    verificationUriComplete: complete.toString(),
    expiresIn,
    interval,
  };
}
