/**
 * ROK-1953 §4.1 — Steam achievement fetchers for the shared Core Steam cards.
 * Plain functions (no Nest), built on `steamFetch`. Classification is
 * body-first: `private` and `not_owned` need Steam's own error text, so an
 * HTML error page or an unknown body is `error`, never `private`. Response
 * shapes are UNVERIFIED (see testing/steam-achievements.fixtures.ts).
 * The API key goes only into the request URL — never into a result or a log.
 */
import { STEAM_API_BASE, steamFetch } from './steam-http.util';
import {
  parseJsonBody,
  parsePercentages,
  parseSchema,
  parseUnlocked,
  playerStatsOf,
  type SteamSchemaAchievement,
  type SteamUnlockedAchievement,
} from './steam-achievements-parse.helpers';

export type { SteamSchemaAchievement, SteamUnlockedAchievement };

/** Per-request ceiling; a slow Steam must not stall the nightly run. */
export const STEAM_ACHIEVEMENTS_TIMEOUT_MS = 10_000;

/** A failure shared by every fetcher. `status` 0 = network error / timeout. */
export type SteamFetchFailure =
  { kind: 'rate_limited' } | { kind: 'error'; status: number };

export type SteamPlayerAchievementsResult =
  | { kind: 'ok'; unlocked: SteamUnlockedAchievement[] }
  | { kind: 'private' }
  | { kind: 'not_owned' }
  | SteamFetchFailure;

export type SteamSchemaResult =
  | {
      kind: 'ok';
      achievements: SteamSchemaAchievement[];
      missingHidden: number;
    }
  | SteamFetchFailure;

export type SteamGlobalPercentagesResult =
  { kind: 'ok'; percentages: Map<string, number> } | SteamFetchFailure;

type SteamCall = {
  kind: 'response';
  status: number;
  ok: boolean;
  body: unknown;
};

const USER_STATS = `${STEAM_API_BASE}/ISteamUserStats`;

/** GET a Steam URL with a timeout; a throw (network, abort) becomes `error` 0. */
async function callSteam(url: string): Promise<SteamCall | SteamFetchFailure> {
  try {
    const res = await steamFetch(url, {
      signal: AbortSignal.timeout(STEAM_ACHIEVEMENTS_TIMEOUT_MS),
    });
    if (res.status === 429) return { kind: 'rate_limited' };
    const body = parseJsonBody(await res.text());
    return { kind: 'response', status: res.status, ok: res.ok, body };
  } catch {
    return { kind: 'error', status: 0 };
  }
}

/** Map a Steam `playerstats.error` string to a player state, or undefined. */
function classifyPlayerError(
  error: unknown,
): 'private' | 'not_owned' | undefined {
  if (typeof error !== 'string') return undefined;
  if (/not public/i.test(error)) return 'private';
  if (/no stats/i.test(error)) return 'not_owned';
  return undefined;
}

/**
 * ISteamUserStats/GetPlayerAchievements/v1 — what a player has unlocked in an app.
 * 403 "Profile is not public" → `private`; 400 "Requested app has no stats" → `not_owned`.
 */
export async function getPlayerAchievements(
  apiKey: string,
  steamId: string,
  appId: number,
): Promise<SteamPlayerAchievementsResult> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    appid: String(appId),
  });
  const call = await callSteam(
    `${USER_STATS}/GetPlayerAchievements/v1/?${params.toString()}`,
  );
  if (call.kind !== 'response') return call;
  const stats = playerStatsOf(call.body);
  if (call.ok && stats?.success === true) {
    return { kind: 'ok', unlocked: parseUnlocked(stats) };
  }
  const state = classifyPlayerError(stats?.error);
  return state ? { kind: state } : { kind: 'error', status: call.status };
}

/**
 * ISteamUserStats/GetSchemaForGame/v2 (English) — an app's achievement list.
 * An empty list = the game has no achievements.
 */
export async function getSchemaForGame(
  apiKey: string,
  appId: number,
): Promise<SteamSchemaResult> {
  const params = new URLSearchParams({
    key: apiKey,
    appid: String(appId),
    l: 'english',
  });
  const call = await callSteam(
    `${USER_STATS}/GetSchemaForGame/v2/?${params.toString()}`,
  );
  if (call.kind !== 'response') return call;
  if (!call.ok || call.body === undefined)
    return { kind: 'error', status: call.status };
  return { kind: 'ok', ...parseSchema(call.body) };
}

/**
 * ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2 — global unlock %
 * per achievement api name. Needs no key.
 */
export async function getGlobalAchievementPercentages(
  appId: number,
): Promise<SteamGlobalPercentagesResult> {
  const params = new URLSearchParams({ gameid: String(appId) });
  const url = `${USER_STATS}/GetGlobalAchievementPercentagesForApp/v2/?${params.toString()}`;
  const call = await callSteam(url);
  if (call.kind !== 'response') return call;
  if (!call.ok || call.body === undefined)
    return { kind: 'error', status: call.status };
  return { kind: 'ok', percentages: parsePercentages(call.body) };
}
