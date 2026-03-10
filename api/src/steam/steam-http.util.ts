/**
 * Steam Web API fetch wrapper (ROK-417).
 * Standardizes User-Agent and provides typed helpers for Steam endpoints.
 */

const USER_AGENT =
  'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)';

export async function steamFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      'User-Agent': USER_AGENT,
      ...init?.headers,
    },
  });
}

/** Steam OpenID 2.0 endpoint */
export const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';

/** Steam Web API base URL */
export const STEAM_API_BASE = 'https://api.steampowered.com';

/**
 * Build a Steam OpenID 2.0 authentication URL.
 * See: https://developer.valvesoftware.com/wiki/Steam_Web_API#OpenID
 */
export function buildSteamOpenIdUrl(returnUrl: string): string {
  const params = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnUrl,
    'openid.realm': new URL(returnUrl).origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });

  return `${STEAM_OPENID_URL}?${params.toString()}`;
}

/**
 * Verify a Steam OpenID 2.0 response by making a check_authentication call.
 * Returns the Steam64 ID if valid, null otherwise.
 */
export async function verifySteamOpenId(
  query: Record<string, string>,
): Promise<string | null> {
  // Build verification request — replace mode with check_authentication
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key.startsWith('openid.')) {
      params.set(key, value);
    }
  }
  params.set('openid.mode', 'check_authentication');

  const response = await steamFetch(STEAM_OPENID_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const text = await response.text();

  if (!text.includes('is_valid:true')) {
    return null;
  }

  // Extract Steam64 ID from claimed_id
  // Format: https://steamcommunity.com/openid/id/<steam64id>
  const claimedId = query['openid.claimed_id'] || '';
  const match = claimedId.match(
    /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/,
  );

  return match?.[1] ?? null;
}

/**
 * Steam player summary from GetPlayerSummaries.
 */
export interface SteamPlayerSummary {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  /** 1=private, 2=friendsonly, 3=public */
  communityvisibilitystate: number;
}

/**
 * Fetch player summary from Steam API.
 */
export async function getPlayerSummary(
  apiKey: string,
  steamId: string,
): Promise<SteamPlayerSummary | null> {
  const url = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(apiKey)}&steamids=${encodeURIComponent(steamId)}`;
  const response = await steamFetch(url);

  if (!response.ok) return null;

  const data = (await response.json()) as {
    response: { players: SteamPlayerSummary[] };
  };

  return data.response.players[0] ?? null;
}

/**
 * Steam owned game from GetOwnedGames.
 */
export interface SteamOwnedGame {
  appid: number;
  name: string;
  playtime_forever: number;
  playtime_2weeks?: number;
  img_icon_url?: string;
}

/**
 * Fetch owned games for a Steam user.
 */
export async function getOwnedGames(
  apiKey: string,
  steamId: string,
): Promise<SteamOwnedGame[]> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    include_appinfo: 'true',
    include_played_free_games: 'true',
    format: 'json',
  });

  const url = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/?${params.toString()}`;
  const response = await steamFetch(url);

  if (!response.ok) return [];

  const data = (await response.json()) as {
    response: { game_count?: number; games?: SteamOwnedGame[] };
  };

  return data.response.games ?? [];
}

/**
 * Steam wishlist item from IWishlistService/GetWishlist.
 */
export interface SteamWishlistItem {
  appid: number;
  date_added: number;
}

/**
 * Fetch a user's Steam wishlist via IWishlistService/GetWishlist/v1.
 */
export async function getWishlist(
  apiKey: string,
  steamId: string,
): Promise<SteamWishlistItem[]> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
    format: 'json',
  });

  const url = `${STEAM_API_BASE}/IWishlistService/GetWishlist/v1/?${params.toString()}`;
  const response = await steamFetch(url);

  if (!response.ok) return [];

  const data = (await response.json()) as {
    response: { items?: SteamWishlistItem[] };
  };

  return data.response.items ?? [];
}
