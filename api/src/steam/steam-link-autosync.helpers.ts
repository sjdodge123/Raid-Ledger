import type { Logger } from '@nestjs/common';
import { ITAD_BACKGROUND_FETCH } from '../itad/itad.constants';
import type { SteamService } from './steam.service';
import type { SteamWishlistService } from './steam-wishlist.service';

function warnAutoSyncFailed(
  logger: Logger,
  what: 'library' | 'wishlist',
  userId: number,
  err: unknown,
): void {
  logger.warn(
    `Auto-sync ${what} after Steam link failed for user ${userId}: ${err instanceof Error ? err.message : 'Unknown error'}`,
  );
}

/**
 * Fire-and-forget library + wishlist sync after a public Steam profile is
 * linked. Failures are logged, never thrown — the link already succeeded.
 * The wishlist runs as a background ITAD fetch, so discovery waits out a
 * 429 pause instead of failing fast.
 */
export function startSteamPostLinkSync(
  steamService: SteamService,
  steamWishlistService: SteamWishlistService,
  logger: Logger,
  userId: number,
): void {
  steamService
    .syncLibrary(userId)
    .catch((err: unknown) =>
      warnAutoSyncFailed(logger, 'library', userId, err),
    );
  steamWishlistService
    .syncWishlist(userId, ITAD_BACKGROUND_FETCH)
    .catch((err: unknown) =>
      warnAutoSyncFailed(logger, 'wishlist', userId, err),
    );
}
