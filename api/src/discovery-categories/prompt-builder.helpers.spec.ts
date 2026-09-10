import { buildGenerationPrompt } from './prompt-builder.helpers';

describe('buildGenerationPrompt', () => {
  const baseInput = {
    centroid: [0.4, 0.1, 0.6, 0.0, 0.2, 0.5, 0.0],
    topPlayed: [
      { name: 'Deep Rock Galactic', totalSeconds: 180_000 },
      { name: 'Helldivers 2', totalSeconds: 72_000 },
    ],
    trending: [
      { name: 'Palworld', deltaPct: 140 },
      { name: 'Lethal Company', deltaPct: -30 },
    ],
    existingCategories: [
      { name: 'Community Has Been Playing', categoryType: 'trend' as const },
    ],
    seasonalHints: ['late-spring'],
    maxProposals: 5,
  };

  it('emits system+user messages with json responseFormat', () => {
    const out = buildGenerationPrompt(baseInput);
    expect(out.responseFormat).toBe('json');
    expect(out.messages.length).toBe(2);
    expect(out.messages[0].role).toBe('system');
    expect(out.messages[1].role).toBe('user');
  });

  // ROK-1127 item A2 — rule 5a and the player-count suffix are the two levers
  // that steer proposals toward how the community actually plays together, and
  // both are plain strings a refactor can silently drop.
  it('states the multiplayer preference rule in the system prompt', () => {
    const systemContent = buildGenerationPrompt(baseInput).messages[0].content;

    expect(systemContent).toContain('5a. MULTIPLAYER PREFERENCE');
    expect(systemContent).toContain(
      'roughly 4 out of every 5 proposals must be multiplayer-first',
    );
  });

  it('tags each top-played game with its supported player count', () => {
    const out = buildGenerationPrompt({
      ...baseInput,
      topPlayed: [
        {
          name: 'Helldivers 2',
          totalSeconds: 169_200,
          playerCount: { min: 1, max: 4 },
        },
      ],
    });

    expect(out.messages[1].content).toContain('"Helldivers 2" (47h, 1-4p)');
  });

  it('marks a single-player title rather than printing "1-1p"', () => {
    const out = buildGenerationPrompt({
      ...baseInput,
      topPlayed: [
        {
          name: 'Hades',
          totalSeconds: 36_000,
          playerCount: { min: 1, max: 1 },
        },
      ],
    });

    expect(out.messages[1].content).toContain(
      '"Hades" (10h, 1p (single-player))',
    );
  });

  it('omits the suffix entirely when player count is unknown', () => {
    const out = buildGenerationPrompt({
      ...baseInput,
      topPlayed: [{ name: 'Unknown Game', totalSeconds: 3_600 }],
    });

    expect(out.messages[1].content).toContain('"Unknown Game" (1h)');
  });

  it('locks the 7-axis key order in the system prompt', () => {
    const systemContent = buildGenerationPrompt(baseInput).messages[0].content;
    expect(systemContent).toContain(
      'co_op, pvp, rpg, survival, strategy, social, mmo',
    );
  });

  it('serializes the centroid with axis labels', () => {
    const user = buildGenerationPrompt(baseInput).messages[1].content;
    expect(user).toContain('co_op=0.40');
    expect(user).toContain('mmo=0.00');
  });

  it('notes missing centroid when null', () => {
    const user = buildGenerationPrompt({
      ...baseInput,
      centroid: null,
    }).messages[1].content;
    expect(user).toContain('unavailable');
  });

  it('lists existing categories as a dedup list', () => {
    const user = buildGenerationPrompt(baseInput).messages[1].content;
    expect(user).toContain('Community Has Been Playing');
    expect(user).toContain('do NOT repeat these names');
  });

  it('mentions seasonal hints when provided', () => {
    const user = buildGenerationPrompt(baseInput).messages[1].content;
    expect(user).toContain('late-spring');
  });

  it('falls back gracefully when signal data is empty', () => {
    const user = buildGenerationPrompt({
      centroid: null,
      topPlayed: [],
      trending: [],
      existingCategories: [],
      seasonalHints: [],
      maxProposals: 3,
    }).messages[1].content;
    expect(user).toContain('no data');
    expect(user).toContain('(none — any name is available)');
    expect(user).toContain('Produce up to 3 proposals');
  });
});
