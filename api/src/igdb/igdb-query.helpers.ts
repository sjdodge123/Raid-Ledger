import { Logger } from '@nestjs/common';
import { IGDB_CONFIG, type IgdbApiGame } from './igdb.constants';

const logger = new Logger('IgdbQueryHelpers');

/** Result of an IGDB API query with health tracking info. */
export interface IgdbQueryResult {
  games: IgdbApiGame[];
  callAt: Date;
  success: boolean;
}

/**
 * Execute an arbitrary APICALYPSE query against IGDB.
 * @param body - APICALYPSE query body
 * @param clientId - Twitch Client ID
 * @param token - OAuth2 access token
 * @returns Query result with health tracking info
 */
export async function executeIgdbQuery(
  body: string,
  clientId: string,
  token: string,
): Promise<IgdbQueryResult> {
  try {
    const res = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
      signal: AbortSignal.timeout(IGDB_CONFIG.IGDB_API_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`IGDB API error: ${res.status} ${errText}`);
      throw new Error(`IGDB API error ${res.status}: ${res.statusText}`);
    }

    const games = (await res.json()) as IgdbApiGame[];
    return { games, callAt: new Date(), success: true };
  } catch (err) {
    throw Object.assign(err as Error, {
      _igdbCallAt: new Date(),
      _igdbSuccess: false,
    });
  }
}
