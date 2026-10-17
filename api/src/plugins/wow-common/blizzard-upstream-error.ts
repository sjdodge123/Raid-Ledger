/**
 * Map a failed Blizzard API response to an HttpException (ROK-1636).
 *
 * A raw `Error` becomes a bare 500 "Internal server error" in Nest, so the
 * user never learns why an import, realm lookup or instance/journal lookup
 * failed. Every upstream failure is a 502: the request was fine, Blizzard's
 * answer was not.
 *
 * A 403 is Blizzard refusing the namespace — the game version isn't served by
 * its API (WoW: Forever before launch). It stays a 5xx on purpose so the
 * Sentry filter (which reports status >= 500) still flags a namespace
 * constant that needs replacing; a 4xx would hide that from alerting.
 */
import { BadGatewayException } from '@nestjs/common';

/** What the failed call was fetching, used in the 403 message. */
export type BlizzardResource = 'characters' | 'realms' | 'instances';

/** Where the upstream HTTP status rides on the exception (not in the body). */
interface BlizzardUpstreamCause {
  upstreamStatus: number;
}

/** Build the 502 for a non-404 upstream status. */
export function blizzardUpstreamError(
  status: number,
  resource: BlizzardResource,
  fallbackMessage: string,
): BadGatewayException {
  // Without `description`, an options arg drops `error: 'Bad Gateway'`.
  const options = {
    cause: { upstreamStatus: status },
    description: 'Bad Gateway',
  };
  if (status === 403) {
    return new BadGatewayException(
      `Blizzard's API doesn't serve ${resource} for this game version yet (403).` +
        (resource === 'characters'
          ? " Import isn't available for it right now."
          : ''),
      options,
    );
  }
  return new BadGatewayException(fallbackMessage, options);
}

/**
 * True when `err` is the 502 built above for a Blizzard 403 (namespace
 * refused). Reads the structured cause, never the message copy.
 */
export function isNamespaceRefusal(err: unknown): boolean {
  if (!(err instanceof BadGatewayException)) return false;
  const cause = err.cause as Partial<BlizzardUpstreamCause> | undefined;
  return cause?.upstreamStatus === 403;
}
