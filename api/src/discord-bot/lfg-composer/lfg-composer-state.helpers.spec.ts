/**
 * ROK-1612 AC9 — back navigation never loses typed text and never guesses.
 */
import { LFG_URGENCY_CHOICES } from '../commands/lfg.command.helpers';
import { LFG_COMPOSER_TERM_MAX } from './lfg-composer.constants';
import {
  backTargetFor,
  buildBackCustomId,
  buildGoCustomId,
  buildPickCustomId,
  normalizeComposerTerm,
  parseGoCustomId,
  parseTermCustomId,
  urgencyKeyFor,
  urgencyValueFor,
} from './lfg-composer-state.helpers';

describe('urgency keys', () => {
  it('neutralises the colon that `now:30` would otherwise forge a segment with', () => {
    expect(urgencyKeyFor('now:30')).toBe('now-30');
    expect(urgencyKeyFor('week')).toBe('week');
  });

  it('round-trips every value the live vocabulary declares', () => {
    for (const choice of LFG_URGENCY_CHOICES) {
      const key = urgencyKeyFor(choice.value);
      expect(key).not.toContain(':');
      expect(urgencyValueFor(key, LFG_URGENCY_CHOICES)).toBe(choice.value);
    }
  });

  it('refuses a key the vocabulary no longer carries rather than guessing', () => {
    expect(urgencyValueFor('now-60', LFG_URGENCY_CHOICES)).toBeNull();
  });
});

describe('custom id round-trip', () => {
  it('carries the game, the horizon, the back-origin and the typed term', () => {
    const id = buildGoCustomId({
      urgencyKey: 'now:30',
      gameId: 42,
      origin: 'candidates',
      term: 'deep rok',
    });
    expect(parseGoCustomId(id)).toEqual({
      urgencyKey: 'now-30',
      gameId: 42,
      origin: 'candidates',
      term: 'deep rok',
    });
  });

  it('keeps a term that itself contains a colon intact', () => {
    const id = buildGoCustomId({
      urgencyKey: 'week',
      gameId: 7,
      origin: 'search',
      term: 'half-life: alyx',
    });
    expect(parseGoCustomId(id)?.term).toBe('half-life: alyx');
  });

  it('stays inside Discord’s 100-character ceiling at the longest term', () => {
    const id = buildGoCustomId({
      urgencyKey: 'now:30',
      gameId: 2147483647,
      origin: 'candidates',
      term: 'x'.repeat(LFG_COMPOSER_TERM_MAX),
    });
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it('rejects a forged id rather than writing an intent for game NaN', () => {
    expect(parseGoCustomId('lfgc:go:week:abc:s:rock')).toBeNull();
    expect(parseGoCustomId('lfgc:go:week:-1:s:rock')).toBeNull();
    expect(parseGoCustomId('lfgc:go:week:7:x:rock')).toBeNull();
    expect(parseGoCustomId('lfg:join:7')).toBeNull();
  });

  it('reads the term back off a Back or a select id', () => {
    expect(parseTermCustomId(buildBackCustomId('valhiem'), 'lfgc:back')).toBe(
      'valhiem',
    );
    expect(parseTermCustomId(buildPickCustomId('rock'), 'lfgc:pick')).toBe(
      'rock',
    );
    expect(parseTermCustomId('lfgc:open', 'lfgc:back')).toBeNull();
  });
});

describe('normalizeComposerTerm', () => {
  it('trims, and truncates to what a custom id can carry', () => {
    expect(normalizeComposerTerm('  valheim  ')).toBe('valheim');
    expect(normalizeComposerTerm('y'.repeat(200))).toHaveLength(
      LFG_COMPOSER_TERM_MAX,
    );
  });
});

describe('backTargetFor', () => {
  it('returns to the candidate select when there was one', () => {
    expect(backTargetFor('candidates')).toBe('candidates');
  });

  it('reopens the prefilled modal when the match was unambiguous', () => {
    expect(backTargetFor('search')).toBe('modal');
  });
});
