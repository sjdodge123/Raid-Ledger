import type { Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/** A signed `steam_link` state is honoured for 10 minutes. */
const MAX_STATE_AGE_MS = 10 * 60 * 1000;

function hmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Sign the Steam link state (HMAC-SHA256 over the JSON payload, base64
 * envelope). Extracted from SteamAuthController (ROK-1731 D6), unchanged.
 */
export function signSteamLinkState(payload: object, secret: string): string {
  const data = JSON.stringify(payload);
  const signature = hmac(data, secret);
  return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
}

/**
 * Verify and decode a signed Steam link state. Null when the envelope is
 * malformed, the signature does not match, or the state is over 10 minutes
 * old.
 */
export function verifySteamLinkState(
  state: string,
  secret: string,
  logger: Logger,
): Record<string, unknown> | null {
  try {
    const { data, signature } = JSON.parse(
      Buffer.from(state, 'base64').toString(),
    ) as { data: string; signature: string };
    const expected = hmac(data, secret);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)))
      return null;
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const timestamp = parsed.timestamp as number | undefined;
    if (!timestamp || Date.now() - timestamp > MAX_STATE_AGE_MS) {
      logger.warn('Steam OpenID state parameter expired');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
