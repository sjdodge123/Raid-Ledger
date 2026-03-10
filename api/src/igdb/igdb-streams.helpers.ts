import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { GameStreamsResponseDto } from '@raid-ledger/contract';
import { IGDB_CONFIG } from './igdb.constants';
import { delay } from './igdb-api.helpers';

const logger = new Logger('IgdbStreamsHelpers');

/** Empty response constant for early returns. */
const EMPTY_STREAMS: GameStreamsResponseDto = { streams: [], totalLive: 0 };

/** Twitch streams API response shape. */
interface TwitchStreamsData {
  data: {
    user_name: string;
    title: string;
    viewer_count: number;
    thumbnail_url: string;
    language: string;
  }[];
  pagination: { cursor?: string };
}

/** Map raw Twitch stream data to DTO format. */
function mapStreamsToDto(data: TwitchStreamsData): GameStreamsResponseDto {
  return {
    streams: data.data.map((s) => ({
      userName: s.user_name,
      title: s.title,
      viewerCount: s.viewer_count,
      thumbnailUrl: s.thumbnail_url
        .replace('{width}', '440')
        .replace('{height}', '248'),
      language: s.language,
    })),
    totalLive: data.data.length,
  };
}

/** Execute a single Twitch API fetch with timeout. */
async function executeTwitchFetch(
  twitchGameId: string,
  clientId: string,
  token: string,
): Promise<GameStreamsResponseDto> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    IGDB_CONFIG.TWITCH_API_TIMEOUT_MS,
  );

  const response = await fetch(
    `https://api.twitch.tv/helix/streams?game_id=${encodeURIComponent(twitchGameId)}&first=10`,
    {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    },
  );
  clearTimeout(timeout);

  if (!response.ok) {
    logger.warn(`Twitch streams API error: ${response.status}`);
    return EMPTY_STREAMS;
  }

  return mapStreamsToDto((await response.json()) as TwitchStreamsData);
}

/**
 * Fetch streams from Twitch API with timeout and retry.
 * Retries up to MAX_TWITCH_RETRIES with exponential backoff on abort/timeout.
 */
async function callTwitchApi(
  twitchGameId: string,
  clientId: string,
  token: string,
): Promise<GameStreamsResponseDto> {
  const maxAttempts = IGDB_CONFIG.MAX_TWITCH_RETRIES;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await executeTwitchFetch(twitchGameId, clientId, token);
    } catch (error: unknown) {
      const isAbort =
        error instanceof DOMException && error.name === 'AbortError';

      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Twitch streams fetch attempt ${attempt}/${maxAttempts} failed: ${errorMsg}`,
      );

      if (!isAbort || attempt >= maxAttempts) {
        throw error;
      }

      const backoffMs = Math.pow(2, attempt - 1) * IGDB_CONFIG.BASE_RETRY_DELAY;
      await delay(backoffMs);
    }
  }

  /* istanbul ignore next -- unreachable after loop throws */
  return EMPTY_STREAMS;
}

/**
 * Fetch live Twitch streams for a game.
 * @param db - Database connection
 * @param gameId - Local game ID
 * @param getCredentials - Function to get Twitch clientId
 * @param getToken - Function to get OAuth token
 * @returns Streams response DTO
 */
export async function fetchTwitchStreams(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number,
  getCredentials: () => Promise<{ clientId: string }>,
  getToken: () => Promise<string>,
): Promise<GameStreamsResponseDto> {
  const gameRows = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  if (gameRows.length === 0 || !gameRows[0].twitchGameId) {
    return EMPTY_STREAMS;
  }

  try {
    const { clientId } = await getCredentials();
    const token = await getToken();
    return await callTwitchApi(gameRows[0].twitchGameId, clientId, token);
  } catch (error) {
    logger.error(`Failed to fetch Twitch streams: ${error}`);
    return EMPTY_STREAMS;
  }
}
