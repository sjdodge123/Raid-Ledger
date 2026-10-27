/**
 * ROK-1953 — Steam ISteamUserStats response bodies for unit specs.
 *
 * UNVERIFIED: these are built from Steam's documented response shapes, not
 * captured from a live call (the Lead could not reach Steam when they were
 * written). The L0 fixture check replaces them with captured, anonymised
 * bodies. Specifically unverified: the private-profile 403 body, the
 * "no stats" 400 body, `hidden` as 0/1 on GetSchemaForGame, a hidden
 * achievement's blank/absent `description`, and string percents on
 * GetGlobalAchievementPercentagesForApp/v2. Fake Steam ids only.
 */

export const FAKE_STEAM_ID = '76561190000000001';
export const BG3_APP_ID = 1086940;

/** GetPlayerAchievements/v1 — 200, public profile that owns the game. */
export const PLAYER_ACHIEVEMENTS_OK = {
  playerstats: {
    steamID: FAKE_STEAM_ID,
    gameName: "Baldur's Gate 3",
    achievements: [
      { apiname: 'ACH_FIRST_STEPS', achieved: 1, unlocktime: 1729800000 },
      { apiname: 'ACH_NOT_YET', achieved: 0, unlocktime: 0 },
      { apiname: 'ACH_ANCIENT', achieved: 1, unlocktime: 0 },
    ],
    success: true,
  },
};

/** GetPlayerAchievements/v1 — 200 for a game with stats but no achievements (no `achievements` key). */
export const PLAYER_ACHIEVEMENTS_NONE = {
  playerstats: {
    steamID: FAKE_STEAM_ID,
    gameName: 'No Achievements',
    success: true,
  },
};

/** GetPlayerAchievements/v1 — 403 when Game Details are not public. */
export const PLAYER_ACHIEVEMENTS_PRIVATE = {
  playerstats: { error: 'Profile is not public', success: false },
};

/** GetPlayerAchievements/v1 — 400 when the player does not own the app. */
export const PLAYER_ACHIEVEMENTS_NOT_OWNED = {
  playerstats: { error: 'Requested app has no stats', success: false },
};

/** A 502 from Steam's edge is HTML, not JSON. */
export const STEAM_BAD_GATEWAY_HTML =
  '<html><head><title>502 Bad Gateway</title></head><body>Bad Gateway</body></html>';

/** GetSchemaForGame/v2?l=english — 200. The hidden one has no description. */
export const SCHEMA_OK = {
  game: {
    gameName: "Baldur's Gate 3",
    gameVersion: '1',
    availableGameStats: {
      achievements: [
        {
          name: 'ACH_FIRST_STEPS',
          defaultvalue: 0,
          displayName: 'First Steps',
          hidden: 0,
          description: 'Leave the nautiloid.',
          icon: 'https://cdn.example.invalid/first.jpg',
          icongray: 'https://cdn.example.invalid/first_gray.jpg',
        },
        {
          name: 'ACH_SECRET',
          defaultvalue: 0,
          displayName: 'A Secret Ending',
          hidden: 1,
          description: '',
          icon: 'https://cdn.example.invalid/secret.jpg',
          icongray: 'https://cdn.example.invalid/secret_gray.jpg',
        },
        {
          name: 'ACH_NO_DESC',
          defaultvalue: 0,
          displayName: 'Quiet One',
          hidden: 1,
        },
      ],
    },
  },
};

/** GetSchemaForGame/v2 — 200 for a game with no achievements. */
export const SCHEMA_NO_ACHIEVEMENTS = { game: {} };

/** GetSchemaForGame/v2 — an entry missing `hidden` (OQ5: never infer it as visible). */
export const SCHEMA_MISSING_HIDDEN = {
  game: {
    availableGameStats: {
      achievements: [
        { name: 'ACH_UNKNOWN', displayName: 'Unknown', description: 'x' },
      ],
    },
  },
};

/** GetGlobalAchievementPercentagesForApp/v2 — 200; v2 sends percents as strings. */
export const GLOBAL_PERCENTAGES_OK = {
  achievementpercentages: {
    achievements: [
      { name: 'ACH_FIRST_STEPS', percent: '87.3' },
      { name: 'ACH_SECRET', percent: '3.2' },
      { name: 'ACH_NUMERIC', percent: 12.5 },
      { name: 'ACH_GARBAGE', percent: 'n/a' },
    ],
  },
};
