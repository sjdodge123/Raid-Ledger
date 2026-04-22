/**
 * Tests for the shared graduated axis matcher (ROK-1082 A+B+C).
 *
 * Covers:
 *   - Change A — enriched AXIS_MAPPINGS vocabulary hits new tags
 *   - Change B — multi-tag scoring saturates at SATURATION_COUNT
 *   - Change C — co-occurrence rules contribute partial weights
 *   - IGDB fallback stays binary when tags.length === 0
 */
import { axisMatchScore, SATURATION_COUNT } from './axis-match';

type GameShape = {
  tags: string[];
  genres: number[];
  gameModes: number[];
  themes: number[];
};

function game(overrides: Partial<GameShape> = {}): GameShape {
  return {
    tags: [],
    genres: [],
    gameModes: [],
    themes: [],
    ...overrides,
  };
}

describe('axisMatchScore — direct tag matches (Change B saturation)', () => {
  it('a single matching tag scores 1/SATURATION_COUNT', () => {
    const score = axisMatchScore(
      'co_op',
      game({ tags: ['co-op'] }),
    );
    expect(score).toBeCloseTo(1 / SATURATION_COUNT, 5);
  });

  it('two matching tags score 2/SATURATION_COUNT', () => {
    const score = axisMatchScore(
      'co_op',
      game({ tags: ['co-op', 'online co-op'] }),
    );
    expect(score).toBeCloseTo(2 / SATURATION_COUNT, 5);
  });

  it('SATURATION_COUNT or more matching tags saturate at 1.0', () => {
    const score = axisMatchScore(
      'co_op',
      game({ tags: ['co-op', 'online co-op', 'local co-op'] }),
    );
    expect(score).toBe(1);
  });

  it('tag matching is case-insensitive', () => {
    const lower = axisMatchScore('shooter', game({ tags: ['fps'] }));
    const upper = axisMatchScore('shooter', game({ tags: ['FPS'] }));
    expect(lower).toBe(upper);
  });
});

describe('axisMatchScore — no match returns 0', () => {
  it('returns 0 when no direct tags and no co-occurrence rules fire', () => {
    expect(
      axisMatchScore('mmo', game({ tags: ['puzzle'] })),
    ).toBe(0);
  });
});

describe('axisMatchScore — enriched vocabulary (Change A)', () => {
  it('Team-Based tag hits the pvp axis (new)', () => {
    expect(
      axisMatchScore('pvp', game({ tags: ['team-based'] })),
    ).toBeGreaterThan(0);
  });

  it('Hero Shooter hits the shooter axis (new)', () => {
    expect(
      axisMatchScore('shooter', game({ tags: ['hero shooter'] })),
    ).toBeGreaterThan(0);
  });

  it('Action-Adventure hits the adventure axis (new)', () => {
    expect(
      axisMatchScore('adventure', game({ tags: ['action-adventure'] })),
    ).toBeGreaterThan(0);
  });

  it('Post-apocalyptic hits the sci_fi axis (new)', () => {
    expect(
      axisMatchScore('sci_fi', game({ tags: ['post-apocalyptic'] })),
    ).toBeGreaterThan(0);
  });

  it('Dungeon Crawler hits the rpg axis (new)', () => {
    expect(
      axisMatchScore('rpg', game({ tags: ['dungeon crawler'] })),
    ).toBeGreaterThan(0);
  });
});

describe('axisMatchScore — co-occurrence rules (Change C)', () => {
  it('Multiplayer WITHOUT a Co-op tag contributes to pvp', () => {
    const score = axisMatchScore(
      'pvp',
      game({ tags: ['multiplayer', 'action'] }),
    );
    // Weight 0.5 from the Multiplayer → pvp rule
    expect(score).toBeGreaterThanOrEqual(0.5);
    // Action isn't in pvp direct mapping, so score should be exactly 0.5
    expect(score).toBeCloseTo(0.5, 5);
  });

  it('Multiplayer WITH a Co-op tag does NOT contribute to pvp', () => {
    const score = axisMatchScore(
      'pvp',
      game({ tags: ['multiplayer', 'co-op'] }),
    );
    expect(score).toBe(0);
  });

  it('Multiplayer always contributes a weak signal to social', () => {
    const score = axisMatchScore(
      'social',
      game({ tags: ['multiplayer'] }),
    );
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  it('Action contributes a weak signal to adventure even without adventure-specific tags', () => {
    const score = axisMatchScore(
      'adventure',
      game({ tags: ['action'] }),
    );
    expect(score).toBeGreaterThanOrEqual(0.2);
  });

  it('Call of Duty scenario: FPS + Shooter + Multiplayer scores shooter strong AND pvp partially', () => {
    const cod = game({
      tags: ['multiplayer', 'action', 'fps', 'shooter', 'singleplayer'],
    });
    const shooterScore = axisMatchScore('shooter', cod);
    const pvpScore = axisMatchScore('pvp', cod);
    const socialScore = axisMatchScore('social', cod);
    expect(shooterScore).toBeGreaterThan(0.5); // 2 direct tags → 2/3
    expect(pvpScore).toBeGreaterThanOrEqual(0.5); // Multiplayer + no Co-op → 0.5
    expect(socialScore).toBeGreaterThanOrEqual(0.3); // Multiplayer → 0.3
  });

  it('capped at 1.0 even when direct + conditional would exceed', () => {
    // All three pvp direct tags + Multiplayer-excl bonus
    const score = axisMatchScore(
      'pvp',
      game({
        tags: ['pvp', 'competitive', 'team-based', 'multiplayer', 'esports'],
      }),
    );
    expect(score).toBe(1);
  });
});

describe('axisMatchScore — IGDB fallback stays binary', () => {
  it('returns 1 for any IGDB match when tags are empty', () => {
    expect(
      axisMatchScore('co_op', game({ gameModes: [3] })),
    ).toBe(1);
  });

  it('returns 0 when no IGDB IDs hit and tags are empty', () => {
    expect(
      axisMatchScore('mmo', game({ genres: [99], gameModes: [99] })),
    ).toBe(0);
  });
});
