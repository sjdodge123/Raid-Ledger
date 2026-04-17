import type { TasteProfileAxis } from '@raid-ledger/contract';

/**
 * Per-axis IGDB ID matchers (ROK-948).
 *
 * Each axis matches on any of gameModes / genres / themes present on the
 * game row. A game that matches multiple categories for the same axis
 * still only contributes weight 1.0 for that axis (see taste-vector.helpers).
 */
export interface AxisMapping {
  gameModes: number[];
  genres: number[];
  themes: number[];
}

export const AXIS_MAPPINGS: Record<TasteProfileAxis, AxisMapping> = {
  co_op: {
    gameModes: [3, 4], // Coop, Split screen
    genres: [],
    themes: [40], // Party
  },
  pvp: {
    gameModes: [2, 6], // Multiplayer, Battle Royale
    genres: [4, 36], // Fighting, MOBA
    themes: [],
  },
  rpg: {
    gameModes: [],
    genres: [12, 31, 34], // RPG, Adventure, Visual Novel
    themes: [17, 31, 38], // Fantasy, Drama, Open world
  },
  survival: {
    gameModes: [],
    genres: [13], // Simulator
    themes: [21, 33, 38], // Survival, Sandbox, Open world
  },
  strategy: {
    gameModes: [],
    genres: [11, 15, 16, 24, 35], // RTS, Strategy, TBS, Tactical, Card & Board
    themes: [41], // 4X
  },
  social: {
    gameModes: [],
    genres: [9, 32, 33], // Puzzle, Indie, Arcade
    themes: [27, 40], // Comedy, Party
  },
  mmo: {
    gameModes: [5], // MMO
    genres: [],
    themes: [],
  },
};

/** MMO playtime bonus threshold: games with this much lifetime playtime
 * (in minutes) also contribute to the MMO axis regardless of tags. */
export const MMO_PLAYTIME_BONUS_MIN = 3000;
