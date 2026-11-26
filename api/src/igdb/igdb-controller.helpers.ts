import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { IgdbGameDto } from '@raid-ledger/contract';
import type { ItadService } from '../itad/itad.service';
import type { SettingsService } from '../settings/settings.service';
import { ITAD_INTERACTIVE_FETCH } from '../itad/itad.constants';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import {
  resolveGameBySteamAppId,
  resolveLocalGameBySteamAppId,
} from './igdb-game-lookup.helpers';

/**
 * Handle errors from the game search endpoint.
 * Re-throws as appropriate NestJS HTTP exceptions.
 * @param error - The caught error
 * @param logger - Logger instance for IGDB errors
 * @throws BadRequestException for Zod validation failures
 * @throws InternalServerErrorException for IGDB API errors
 */
export function handleSearchError(error: unknown, logger: Logger): never {
  if (error instanceof Error && error.name === 'ZodError') {
    const messages = (error as ZodError).issues.map(
      (e) => `${e.path.join('.')}: ${e.message}`,
    );
    throw new BadRequestException({
      message: 'Validation failed',
      errors: messages,
    });
  }
  if (error instanceof Error && error.message.includes('IGDB')) {
    logger.error(`IGDB API error: ${error.message}`);
    throw new InternalServerErrorException(
      'Game search service temporarily unavailable',
    );
  }
  throw error;
}

/** Services `GET /games/by-steam-id` needs to resolve an app id. */
export interface SteamAppIdRouteDeps {
  db: PostgresJsDatabase<typeof schema>;
  settingsService: SettingsService;
  itadService: ItadService;
}

/**
 * Resolve a Steam App ID for the route's viewer (ROK-2325). Anonymous callers
 * get the local-DB lookup only; signed-in callers keep ITAD discovery (which
 * may insert a games row — `newGameId` — for the caller to enqueue).
 */
export async function resolveSteamAppIdForViewer(
  steamAppId: number,
  anonymous: boolean,
  deps: SteamAppIdRouteDeps,
): Promise<{ game: IgdbGameDto; newGameId: number | null } | null> {
  if (anonymous) return resolveLocalGameBySteamAppId(deps.db, steamAppId);
  const adultFilter =
    (await deps.settingsService.get(SETTING_KEYS.IGDB_FILTER_ADULT)) === 'true';
  return resolveGameBySteamAppId(steamAppId, {
    db: deps.db,
    lookupBySteamAppId: (id) =>
      deps.itadService.lookupBySteamAppId(id, ITAD_INTERACTIVE_FETCH),
    adultFilterEnabled: adultFilter,
  });
}
