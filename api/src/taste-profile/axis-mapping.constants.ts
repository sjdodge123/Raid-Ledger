import type { TasteProfilePoolAxis } from '@raid-ledger/contract';

/**
 * Per-axis IGDB ID matchers (ROK-948 / ROK-949 dynamic-axes extension).
 *
 * Each axis matches on any of gameModes / genres / themes present on the
 * game row. A game that matches multiple categories for the same axis
 * still only contributes weight 1.0 for that axis (see taste-vector.helpers).
 *
 * Mappings target *specific* IGDB IDs so an "Open world" theme tag doesn't
 * bleed into RPG and "Adventure" genre doesn't bleed into RPG either. The
 * backend computes scores across every pool axis; the UI renders only the
 * top 7 for each player.
 */
export interface AxisMapping {
  gameModes: number[];
  genres: number[];
  themes: number[];
}

export const AXIS_MAPPINGS: Record<TasteProfilePoolAxis, AxisMapping> = {
  co_op: {
    gameModes: [3, 4], // Co-operative, Split screen
    genres: [],
    themes: [],
  },
  pvp: {
    gameModes: [2], // Multiplayer (broad — may overlap co-op)
    genres: [],
    themes: [],
  },
  battle_royale: {
    gameModes: [6],
    genres: [],
    themes: [],
  },
  mmo: {
    gameModes: [5],
    genres: [],
    themes: [],
  },
  moba: {
    gameModes: [],
    genres: [36],
    themes: [],
  },
  fighting: {
    gameModes: [],
    genres: [4, 25], // Fighting, Hack and slash / Beat 'em up
    themes: [],
  },
  shooter: {
    gameModes: [],
    genres: [5],
    themes: [],
  },
  racing: {
    gameModes: [],
    genres: [10],
    themes: [],
  },
  sports: {
    gameModes: [],
    genres: [14],
    themes: [],
  },
  rpg: {
    gameModes: [],
    genres: [12, 34], // Role-playing, Visual Novel (Adventure split out)
    themes: [],
  },
  fantasy: {
    gameModes: [],
    genres: [],
    themes: [17],
  },
  sci_fi: {
    gameModes: [],
    genres: [],
    themes: [18],
  },
  adventure: {
    gameModes: [],
    genres: [31],
    themes: [31], // Drama
  },
  strategy: {
    gameModes: [],
    genres: [15, 24], // Strategy, Tactical
    themes: [41], // 4X
  },
  rts: {
    gameModes: [],
    genres: [11],
    themes: [],
  },
  tbs: {
    gameModes: [],
    genres: [16],
    themes: [],
  },
  survival: {
    gameModes: [],
    genres: [],
    themes: [21],
  },
  sandbox: {
    gameModes: [],
    genres: [],
    themes: [33, 38], // Sandbox, Open world
  },
  horror: {
    gameModes: [],
    genres: [],
    themes: [19],
  },
  social: {
    gameModes: [],
    genres: [9, 35], // Puzzle, Card & Board
    themes: [40, 27], // Party, Comedy
  },
};

/** MMO playtime bonus threshold: games with this much lifetime playtime
 * (in minutes) also contribute to the MMO axis regardless of tags. */
export const MMO_PLAYTIME_BONUS_MIN = 3000;
