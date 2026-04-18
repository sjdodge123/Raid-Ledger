/**
 * Unit tests for signal aggregation → 7-axis taste vector (ROK-948 AC 11).
 */
import {
  axisMatchFactor,
  computeTasteVector,
  signalWeight,
  type GameMetadata,
  type UserGameSignal,
} from './taste-vector.helpers';

describe('signalWeight (ROK-948 AC 11)', () => {
  it('returns 0.02 for bare ownership with no playtime (library-tail weak signal)', () => {
    expect(
      signalWeight({
        gameId: 1,
        steamOwnership: { playtimeForever: 0, playtime2weeks: 0 },
      }),
    ).toBeCloseTo(0.02);
  });

  it('returns 1.0 for ownership with >3000 min lifetime playtime', () => {
    expect(
      signalWeight({
        gameId: 1,
        steamOwnership: { playtimeForever: 5000, playtime2weeks: 0 },
      }),
    ).toBeCloseTo(1.0);
  });

  it('scales recent playtime between 0.5 and 1.0', () => {
    const w = signalWeight({
      gameId: 1,
      steamOwnership: { playtimeForever: 500, playtime2weeks: 180 },
    });
    // 0.5 + min(180/600, 0.5) = 0.5 + 0.3 = 0.8
    expect(w).toBeGreaterThan(0.5);
    expect(w).toBeLessThan(1.0);
  });

  it('adds wishlist (0.2), heart (0.5), event signup (0.7), voice (1.0), poll (0.4) cumulatively', () => {
    expect(
      signalWeight({
        gameId: 1,
        steamWishlist: true,
        manualHeart: true,
        eventSignup: true,
        voiceAttendance: true,
        pollSource: true,
      }),
    ).toBeCloseTo(0.2 + 0.5 + 0.7 + 1.0 + 0.4);
  });

  it('scales presence weekly hours by min(hours/10, 1.0)', () => {
    expect(signalWeight({ gameId: 1, presenceWeeklyHours: 5 })).toBeCloseTo(
      0.5,
    );
    expect(signalWeight({ gameId: 1, presenceWeeklyHours: 15 })).toBeCloseTo(
      1.0,
    );
  });

  it('returns 0 for a signal with no sources', () => {
    expect(signalWeight({ gameId: 1 })).toBe(0);
  });
});

describe('axisMatchFactor (ROK-948 AC 11)', () => {
  const coopGame: GameMetadata = {
    gameId: 1,
    genres: [],
    gameModes: [3], // Coop
    themes: [],
    tags: [],
  };
  const rpgGame: GameMetadata = {
    gameId: 2,
    genres: [12], // RPG
    gameModes: [],
    themes: [],
    tags: [],
  };
  const bareGame: GameMetadata = {
    gameId: 3,
    genres: [],
    gameModes: [],
    themes: [],
    tags: [],
  };

  it('matches co_op via gameModes', () => {
    expect(axisMatchFactor('co_op', coopGame)).toBe(1.0);
  });

  it('matches rpg via genres', () => {
    expect(axisMatchFactor('rpg', rpgGame)).toBe(1.0);
  });

  it('does not match when none of the mappings apply', () => {
    expect(axisMatchFactor('pvp', coopGame)).toBe(0);
    expect(axisMatchFactor('mmo', rpgGame)).toBe(0);
  });

  it('does not award MMO axis based on playtime alone', () => {
    // Prior code awarded a +1.0 MMO bonus for games with >3000min playtime
    // regardless of genre. That was over-broad (PUBG/Satisfactory hit MMO).
    // MMO is now detected via tags (MMORPG/MMO/Massively Multiplayer) or
    // IGDB gameMode 5 only. `axisMatchFactor` no longer takes a signal.
    expect(axisMatchFactor('mmo', bareGame)).toBe(0);
  });

  it('matches mmo via IGDB gameMode 5 (Massively Multiplayer)', () => {
    const mmoGame: GameMetadata = {
      gameId: 99,
      genres: [],
      gameModes: [5],
      themes: [],
      tags: [],
    };
    expect(axisMatchFactor('mmo', mmoGame)).toBe(1.0);
  });
});

describe('computeTasteVector (ROK-948 AC 11)', () => {
  const games = new Map<number, GameMetadata>([
    [10, { gameId: 10, genres: [12], gameModes: [], themes: [], tags: [] }], // RPG
    [11, { gameId: 11, genres: [], gameModes: [3], themes: [], tags: [] }], // Coop
    [12, { gameId: 12, genres: [15], gameModes: [], themes: [], tags: [] }], // Strategy
  ]);

  it('returns zeroed dimensions + zero vector for an empty signal list', () => {
    const out = computeTasteVector([], games);
    expect(out.vector).toHaveLength(7);
    expect(out.vector.every((v) => v === 0)).toBe(true);
    for (const v of Object.values(out.dimensions)) expect(v).toBe(0);
  });

  it('self-normalizes so the strongest axis scores 100', () => {
    const signals: UserGameSignal[] = [
      {
        gameId: 10,
        steamOwnership: { playtimeForever: 5000, playtime2weeks: 0 },
      },
    ];
    const out = computeTasteVector(signals, games);
    expect(out.dimensions.rpg).toBe(100);
    expect(out.dimensions.co_op).toBe(0);
    expect(out.vector).toHaveLength(7);
    expect(Math.max(...out.vector)).toBe(1);
  });

  it('populates multiple axes proportionally when the user plays diverse games', () => {
    const signals: UserGameSignal[] = [
      {
        gameId: 10,
        steamOwnership: { playtimeForever: 5000, playtime2weeks: 0 },
      },
      {
        gameId: 11,
        steamOwnership: { playtimeForever: 5000, playtime2weeks: 0 },
      },
    ];
    const out = computeTasteVector(signals, games);
    expect(out.dimensions.rpg).toBeGreaterThan(0);
    expect(out.dimensions.co_op).toBeGreaterThan(0);
  });

  it('silently drops signals for games missing from the metadata map', () => {
    const signals: UserGameSignal[] = [
      {
        gameId: 999,
        steamOwnership: { playtimeForever: 10000, playtime2weeks: 0 },
      },
    ];
    const out = computeTasteVector(signals, games);
    for (const v of Object.values(out.dimensions)) expect(v).toBe(0);
  });
});
