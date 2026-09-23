/**
 * Map a failed Blizzard API response to an HttpException (ROK-1636).
 *
 * A raw `Error` becomes a bare 500 "Internal server error" in Nest, so the
 * user never learns why an import or realm lookup failed. Every upstream
 * failure is a 502: the request was fine, Blizzard's answer was not.
 *
 * A 403 is Blizzard refusing the namespace — the game version isn't served by
 * its API (WoW: Forever before launch). It stays a 5xx on purpose so the
 * Sentry filter (which reports status >= 500) still flags a namespace
 * constant that needs replacing; a 4xx would hide that from alerting.
 */
import { BadGatewayException } from '@nestjs/common';

/** What the failed call was fetching, used in the 403 message. */
export type BlizzardResource = 'characters' | 'realms';

/** Build the 502 for a non-404 upstream status. */
export function blizzardUpstreamError(
  status: number,
  resource: BlizzardResource,
  fallbackMessage: string,
): BadGatewayException {
  if (status === 403) {
    return new BadGatewayException(
      `Blizzard's API doesn't serve ${resource} for this game version yet (403).` +
        (resource === 'characters'
          ? " Import isn't available for it right now."
          : ''),
    );
  }
  return new BadGatewayException(fallbackMessage);
}
