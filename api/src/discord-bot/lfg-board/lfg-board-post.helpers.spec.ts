/**
 * ROK-1471 AC6 — thread name + forum tag, derived from the SAME view the
 * embed renders.
 *
 * The tag vocabulary is imported from `LFG_BOARD_TAGS`, never retyped: AC6 is
 * literally "the forum's tag filter and the embed's author line say the same
 * words", so a test that spelled the words out again could stay green while
 * the two surfaces drifted apart.
 *
 * Viability is the other trap. `NEEDS PLAYERS` vs `READY TO SCHEDULE` is the
 * one branch a local `count >= 4` could fake, so the null-threshold case is
 * pinned: `deriveViability` is false forever without a threshold, and a shortcut
 * that read "no threshold ⇒ ready" would be caught here rather than in Discord.
 */
import { LFG_BOARD_TAGS } from './lfg-board.constants';
import { tagFor, threadNameFor } from './lfg-board-post.helpers';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';

const [NEEDS, READY, SCHEDULED, EXPIRED, CLOSED] = LFG_BOARD_TAGS;

function view(overrides: Partial<LfmGroupView> = {}): LfmGroupView {
  return {
    state: 'open',
    gameId: 42,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    memberCount: 2,
    memberNames: ['Bosco', 'Karl'],
    viabilityThreshold: 4,
    ...overrides,
  };
}

describe('tagFor — every render state maps to exactly one board tag (AC6)', () => {
  it('is NEEDS PLAYERS while open and short of the threshold', () => {
    expect(tagFor(view())).toBe(NEEDS);
  });

  it('is READY TO SCHEDULE once the threshold is met', () => {
    expect(tagFor(view({ memberCount: 4 }))).toBe(READY);
  });

  it('stays NEEDS PLAYERS forever when the threshold is unknown', () => {
    // `deriveViability` is false without a threshold however many turn up. A
    // local `count >= n` shortcut would flip this to READY and be caught.
    expect(tagFor(view({ viabilityThreshold: null, memberCount: 99 }))).toBe(
      NEEDS,
    );
  });

  it.each([
    ['scheduled' as const, SCHEDULED],
    ['expired' as const, EXPIRED],
    ['closed' as const, CLOSED],
  ])('is %s at the matching terminal state', (state, expected) => {
    // Terminal is terminal regardless of head-count: a SCHEDULED group still
    // over its threshold is done, not ready.
    expect(tagFor(view({ state, memberCount: 6 }))).toBe(expected);
  });

  it('only ever returns a tag the forum actually carries', () => {
    const states = ['open', 'scheduled', 'expired', 'closed'] as const;
    for (const state of states) {
      expect(LFG_BOARD_TAGS).toContain(tagFor(view({ state })));
    }
  });
});

describe('threadNameFor — the forum list line (AC6)', () => {
  it('counts the group while it is open', () => {
    expect(threadNameFor(view({ memberCount: 3 }))).toBe(
      'Deep Rock Galactic · 3 looking',
    );
  });

  it.each([
    ['scheduled' as const, 'Deep Rock Galactic · scheduled'],
    ['expired' as const, 'Deep Rock Galactic · expired'],
    ['closed' as const, 'Deep Rock Galactic · closed'],
  ])('drops the count at %s', (state, expected) => {
    // A head-count on an archived thread reads as live. The state word is the
    // honest label once nothing can change it.
    expect(threadNameFor(view({ state, memberCount: 6 }))).toBe(expected);
  });

  it('never exceeds the 100-character thread-name limit Discord enforces', () => {
    // A game with a long name would otherwise fail `threads.create` outright,
    // costing the group its whole post rather than a few characters.
    const name = threadNameFor(
      view({ gameName: 'Deep Rock Galactic '.repeat(12) }),
    );

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toContain('2 looking');
  });
});
