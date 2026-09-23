/**
 * ROK-1612 AC2 — the four outcomes, and the rule that binds three of them:
 * nothing ambiguous and nothing fuzzy ever resolves itself.
 */
import {
  classifyComposerMatch,
  normalizeForCompare,
  type LfgComposerGame,
} from './lfg-composer-search.helpers';

const VALHEIM: LfgComposerGame = { id: 1, name: 'Valheim' };
const VALORANT: LfgComposerGame = { id: 2, name: 'Valorant' };
const DRG: LfgComposerGame = { id: 3, name: 'Deep Rock Galactic' };
const BG3: LfgComposerGame = { id: 4, name: "Baldur's Gate III" };

describe('classifyComposerMatch', () => {
  it('(a) narrows a single word-filter hit to that one game', () => {
    const match = classifyComposerMatch('valheim', [VALHEIM]);
    expect(match).toEqual({ kind: 'single', game: VALHEIM });
  });

  it('(b) an exact title among several rows lists them all, the exact title first (ROK-1658)', () => {
    const sequel: LfgComposerGame = { id: 9, name: 'Valheim 2' };
    const match = classifyComposerMatch('valheim', [sequel, VALHEIM]);
    expect(match).toEqual({ kind: 'candidates', games: [VALHEIM, sequel] });
  });

  it('(b) matches an exact title through punctuation, as /lfg does, and leads with it', () => {
    const match = classifyComposerMatch('baldurs gate iii', [VALORANT, BG3]);
    expect(match).toEqual({ kind: 'candidates', games: [BG3, VALORANT] });
  });

  it('(b) keeps the exact title inside the 25-option cap even when it ranked last', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: i + 100,
      name: `Valheim Mod ${String(i)}`,
    }));
    const match = classifyComposerMatch('valheim', [...many, VALHEIM]);
    expect(match.kind).toBe('candidates');
    const games = match.kind === 'candidates' ? match.games : [];
    expect(games).toHaveLength(25);
    expect(games[0]).toEqual(VALHEIM);
  });

  it('(b) offers several candidates rather than picking the top one', () => {
    const match = classifyComposerMatch('rock', [DRG, VALORANT, VALHEIM]);
    expect(match.kind).toBe('candidates');
    expect(match).toMatchObject({ games: [DRG, VALORANT, VALHEIM] });
  });

  it('(c) falls back to the trigram set only when the word filter is empty', () => {
    const match = classifyComposerMatch('deep rok', [], [DRG]);
    expect(match).toEqual({ kind: 'fuzzy', games: [DRG] });
  });

  it('(c) NEVER auto-selects a lone trigram hit — 0.33 is a guess, not an answer', () => {
    const match = classifyComposerMatch('valhiem', [], [VALHEIM]);
    expect(match.kind).toBe('fuzzy');
    expect(match.kind).not.toBe('single');
  });

  it('(c) keeps a near-miss neighbour visible instead of choosing between them', () => {
    const match = classifyComposerMatch('valhiem', [], [VALHEIM, VALORANT]);
    expect(match).toEqual({ kind: 'fuzzy', games: [VALHEIM, VALORANT] });
  });

  it('(c) ignores the trigram set when the word filter already matched', () => {
    const match = classifyComposerMatch('rock', [DRG, VALORANT], [VALHEIM]);
    expect(match).toMatchObject({ kind: 'candidates', games: [DRG, VALORANT] });
  });

  it('(d) reports nothing when neither query found anything — bg3 is the known miss', () => {
    expect(classifyComposerMatch('bg3', [], [])).toEqual({ kind: 'none' });
  });

  it('caps a candidate list at the 25 options Discord accepts', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: i + 100,
      name: `Rock Game ${String(i)}`,
    }));
    const match = classifyComposerMatch('rock', many);
    expect(match).toMatchObject({ kind: 'candidates' });
    if (match.kind !== 'candidates') throw new Error('expected candidates');
    expect(match.games).toHaveLength(25);
  });

  it('does not treat an empty term as an exact match on an empty-ish title', () => {
    const blank: LfgComposerGame = { id: 7, name: '!!!' };
    const match = classifyComposerMatch('', [blank, VALORANT]);
    expect(match.kind).toBe('candidates');
  });
});

describe('normalizeForCompare', () => {
  it('strips punctuation and case so a typed title reaches its row', () => {
    expect(normalizeForCompare("Baldur's Gate III")).toBe('baldurs gate iii');
  });
});
