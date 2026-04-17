import type { TasteProfilePoolAxis } from '@raid-ledger/contract';

/**
 * Per-axis matchers (ROK-948 / ROK-949 dynamic-axes extension).
 *
 * Priority order when classifying a game for an axis:
 *   1. `tags` (Steam/IsThereAnyDeal user tags — richest vocabulary,
 *      covers specific sub-genres IGDB's schema lacks: "Automation",
 *      "Crafting", "Roguelike", "Battle Royale", etc.)
 *   2. `gameModes` / `genres` / `themes` (IGDB IDs — fallback for
 *      games whose itad tags haven't been fetched yet)
 *
 * A game hits an axis if ANY listed identifier matches; the axis then
 * contributes `1.0 * signalWeight(user, game)` to that user's raw score
 * (see taste-vector.helpers). Tag matching is case-insensitive.
 */
export interface AxisMapping {
  tags: string[];
  gameModes: number[];
  genres: number[];
  themes: number[];
}

export const AXIS_MAPPINGS: Record<TasteProfilePoolAxis, AxisMapping> = {
  co_op: {
    tags: ['Co-op', 'Online Co-Op', 'Local Co-Op'],
    gameModes: [3, 4],
    genres: [],
    themes: [],
  },
  pvp: {
    tags: ['PvP', 'Competitive'],
    gameModes: [2],
    genres: [],
    themes: [],
  },
  battle_royale: {
    tags: ['Battle Royale'],
    gameModes: [6],
    genres: [],
    themes: [],
  },
  mmo: {
    tags: ['MMORPG', 'MMO', 'Massively Multiplayer'],
    gameModes: [5],
    genres: [],
    themes: [],
  },
  moba: {
    tags: ['MOBA'],
    gameModes: [],
    genres: [36],
    themes: [],
  },
  fighting: {
    tags: ['Fighting', "Beat 'em up", '2D Fighter', '3D Fighter'],
    gameModes: [],
    genres: [4, 25],
    themes: [],
  },
  shooter: {
    tags: ['FPS', 'Shooter', 'First-Person', 'Third-Person Shooter'],
    gameModes: [],
    genres: [5],
    themes: [],
  },
  racing: {
    tags: ['Racing', 'Driving'],
    gameModes: [],
    genres: [10],
    themes: [],
  },
  sports: {
    tags: ['Sports', 'Football', 'Basketball', 'Soccer'],
    gameModes: [],
    genres: [14],
    themes: [],
  },
  rpg: {
    tags: ['RPG', 'Action RPG', 'JRPG', 'CRPG', 'Party-Based RPG'],
    gameModes: [],
    genres: [12, 34],
    themes: [],
  },
  fantasy: {
    tags: ['Fantasy', 'Magic', 'Dragons'],
    gameModes: [],
    genres: [],
    themes: [17],
  },
  sci_fi: {
    tags: ['Sci-fi', 'Space', 'Cyberpunk', 'Futuristic'],
    gameModes: [],
    genres: [],
    themes: [18],
  },
  adventure: {
    tags: ['Adventure', 'Story Rich', 'Exploration'],
    gameModes: [],
    genres: [31],
    themes: [31],
  },
  strategy: {
    tags: [
      'Strategy',
      'RTS',
      'Real Time Strategy',
      'Turn-Based Strategy',
      'Turn-Based',
      '4X',
      'Grand Strategy',
      'Wargame',
      'Tactics',
      'Auto Battler',
      'Tower Defense',
    ],
    gameModes: [],
    genres: [11, 15, 16, 24],
    themes: [41],
  },
  survival: {
    tags: ['Survival', 'Open World Survival Craft'],
    gameModes: [],
    genres: [],
    themes: [21],
  },
  crafting: {
    tags: ['Crafting', 'Open World Survival Craft'],
    gameModes: [],
    genres: [],
    themes: [],
  },
  automation: {
    tags: [
      'Automation',
      'Base Building',
      'Factory Building',
      'Factory Sim',
      'Resource Management',
      'City Builder',
      'Building',
    ],
    gameModes: [],
    genres: [],
    themes: [],
  },
  sandbox: {
    tags: ['Sandbox', 'Open World'],
    gameModes: [],
    genres: [],
    themes: [33, 38],
  },
  horror: {
    tags: ['Horror', 'Psychological Horror', 'Survival Horror'],
    gameModes: [],
    genres: [],
    themes: [19],
  },
  social: {
    tags: ['Party', 'Casual', 'Local Multiplayer'],
    gameModes: [],
    genres: [9, 35],
    themes: [40, 27],
  },
  roguelike: {
    tags: [
      'Roguelike',
      'Roguelite',
      'Rogue-like',
      'Rogue-lite',
      'Action Roguelike',
      'Traditional Roguelike',
      'Roguelike Deckbuilder',
      'Roguevania',
    ],
    gameModes: [],
    genres: [],
    themes: [],
  },
  puzzle: {
    tags: ['Puzzle', 'Point & Click', 'Logic', 'Math'],
    gameModes: [],
    genres: [9],
    themes: [],
  },
  platformer: {
    tags: ['Platformer', '2D Platformer', '3D Platformer', 'Metroidvania'],
    gameModes: [],
    genres: [8],
    themes: [],
  },
  stealth: {
    tags: ['Stealth'],
    gameModes: [],
    genres: [],
    themes: [43],
  },
};

/**
 * Lifetime Steam playtime threshold (minutes) above which a game is
 * considered "heavily played" — its signal weight jumps to 1.0 for
 * every matching axis. No longer MMO-specific (a prior version applied
 * an MMO-axis bonus here; that was removed in favour of tag/gameMode
 * based MMO detection).
 */
export const HIGH_PLAYTIME_WEIGHT_MIN = 3000;
