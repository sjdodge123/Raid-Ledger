/**
 * Tests for the shared graduated axis matcher (ROK-1082 A+B+C).
 *
 * Covers:
 *   - Change A — enriched AXIS_MAPPINGS vocabulary hits new tags
 *   - Change B — multi-tag scoring saturates at SATURATION_COUNT
 *   - Change C — co-occurrence rules contribute partial weights
 *   - IGDB fallback stays binary when tags.length === 0
 *   - ROK-1939 D9 — pvp narrowed (no Multiplayer rule, no IGDB mode 2,
 *     no Team-Based / Class-Based tags)
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
    const score = axisMatchScore('co_op', game({ tags: ['co-op'] }));
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
    expect(axisMatchScore('mmo', game({ tags: ['puzzle'] }))).toBe(0);
  });
});

describe('axisMatchScore — enriched vocabulary (Change A)', () => {
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
  // ROK-1939 D9 (operator ruling): the Multiplayer → pvp 0.5 rule is gone.
  it('Multiplayer WITHOUT a Co-op tag no longer contributes to pvp', () => {
    const score = axisMatchScore(
      'pvp',
      game({ tags: ['multiplayer', 'action'] }),
    );
    expect(score).toBe(0);
  });

  it('Multiplayer WITH a Co-op tag does NOT contribute to pvp', () => {
    const score = axisMatchScore(
      'pvp',
      game({ tags: ['multiplayer', 'co-op'] }),
    );
    expect(score).toBe(0);
  });

  it('Multiplayer always contributes a weak signal to social', () => {
    const score = axisMatchScore('social', game({ tags: ['multiplayer'] }));
    expect(score).toBeGreaterThanOrEqual(0.3);
  });

  it('Action contributes a weak signal to adventure even without adventure-specific tags', () => {
    const score = axisMatchScore('adventure', game({ tags: ['action'] }));
    expect(score).toBeGreaterThanOrEqual(0.2);
  });

  it('Call of Duty scenario: FPS + Shooter + Multiplayer scores shooter/fps strong and pvp 0 (ROK-1939 D9)', () => {
    const cod = game({
      tags: ['multiplayer', 'action', 'fps', 'shooter', 'singleplayer'],
    });
    expect(axisMatchScore('shooter', cod)).toBeGreaterThan(0.5); // 2 direct → 2/3
    expect(axisMatchScore('fps', cod)).toBeGreaterThan(0);
    expect(axisMatchScore('pvp', cod)).toBe(0); // no PvP vocabulary
    expect(axisMatchScore('social', cod)).toBeCloseTo(0.3, 5); // Multiplayer → 0.3
  });

  it('capped at 1.0 even when direct + conditional would exceed', () => {
    // 3 direct social tags (1.0) + the Multiplayer → social bonus (0.3)
    // would be 1.3 uncapped.
    const score = axisMatchScore(
      'social',
      game({
        tags: ['party', 'casual', 'local multiplayer', 'multiplayer'],
      }),
    );
    expect(score).toBe(1);
  });
});

describe('axisMatchScore — IGDB fallback stays binary', () => {
  it('returns 1 for any IGDB match when tags are empty', () => {
    expect(axisMatchScore('co_op', game({ gameModes: [3] }))).toBe(1);
  });

  it('returns 0 when no IGDB IDs hit and tags are empty', () => {
    expect(axisMatchScore('mmo', game({ genres: [99], gameModes: [99] }))).toBe(
      0,
    );
  });
});

/**
 * ROK-1102 item 5 — `fps` as a dedicated pool axis (spec §4.1 units 1-4).
 *
 * D3: `fps` is a SPECIALISATION of `shooter`, not a reassignment — an FPS
 * game fires BOTH axes and `shooter`'s vocabulary is left untouched.
 * D5: no IGDB fallback for `fps` — IGDB genre 5 ("Shooter") does not encode
 * perspective, so a tag-less game can never reach `fps`.
 */
describe('axisMatchScore — fps axis (ROK-1102 #5)', () => {
  it('an FPS-tagged game scores BOTH fps and shooter', () => {
    const fpsGame = game({
      tags: ['FPS', 'First-Person', 'Tactical Shooter', 'Multiplayer'],
    });
    expect(axisMatchScore('fps', fpsGame)).toBe(1);
    expect(axisMatchScore('shooter', fpsGame)).toBeGreaterThan(0);
  });

  it('a non-FPS shooter scores shooter only', () => {
    const tpsGame = game({ tags: ['Third-Person Shooter', 'Looter Shooter'] });
    expect(axisMatchScore('shooter', tpsGame)).toBeGreaterThan(0);
    expect(axisMatchScore('fps', tpsGame)).toBe(0);
  });

  it('a lone FPS tag graduates at 1/SATURATION_COUNT instead of saturating', () => {
    expect(axisMatchScore('fps', game({ tags: ['FPS'] }))).toBeCloseTo(
      1 / SATURATION_COUNT,
      5,
    );
  });

  it('does not reach fps via the IGDB shooter-genre fallback (D5)', () => {
    const tagless = game({ tags: [], genres: [5] });
    expect(axisMatchScore('shooter', tagless)).toBe(1);
    expect(axisMatchScore('fps', tagless)).toBe(0);
  });
});

describe('axisMatchScore — narrowed pvp axis (ROK-1939 D9)', () => {
  it('an untagged IGDB Multiplayer (mode 2) game scores pvp 0', () => {
    expect(axisMatchScore('pvp', game({ gameModes: [2] }))).toBe(0);
  });

  it.each(['team-based', 'class-based'])(
    'the dropped %s tag no longer hits pvp',
    (tag) => {
      expect(axisMatchScore('pvp', game({ tags: [tag] }))).toBe(0);
    },
  );

  it('explicit competitive vocabulary still saturates pvp', () => {
    const score = axisMatchScore(
      'pvp',
      game({ tags: ['pvp', 'competitive', 'esports'] }),
    );
    expect(score).toBe(1);
  });
});
