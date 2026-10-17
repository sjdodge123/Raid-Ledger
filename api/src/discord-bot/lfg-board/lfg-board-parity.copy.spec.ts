/**
 * ROK-1505 AC9 — the chip sentence and the post title come from ONE formatter.
 *
 * `api`'s jest maps `@raid-ledger/contract` to the contract SOURCE, so these
 * assertions go red the moment `packages/contract/src/lfg-copy.ts` changes —
 * the same moment the web's `lfg-chip-copy.contract.test.ts` does. Break the
 * string in one place and both workspaces fail; that is the whole point.
 *
 * The strings are pinned as literals on purpose: an assertion of the form
 * `threadNameFor(v) === game + groupLine(...)` alone would stay green if
 * `groupLine` itself drifted from what the operator saw on the chip.
 */
import {
  DEFAULT_VIABILITY_THRESHOLD,
  effectiveLfgState,
  groupLine,
  playersStillNeeded,
} from '@raid-ledger/contract';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import { threadNameFor } from './lfg-board-thread.helpers';

function view(overrides: Partial<LfmGroupView>): LfmGroupView {
  return {
    state: 'open',
    gameId: 12,
    gameName: 'Final Fantasy XIV Online',
    gameSlug: 'ffxiv',
    memberCount: 1,
    ...overrides,
  };
}

describe('groupLine — the sentence the operator quoted from the chip', () => {
  it('reads "1 looking · needs 1 more" at one hand with no Co-Optimus data', () => {
    expect(groupLine(1, effectiveLfgState(1), null)).toBe(
      '1 looking · needs 1 more',
    );
    expect(DEFAULT_VIABILITY_THRESHOLD).toBe(2);
  });

  it('never reads "needs 0 more" — the clamp is part of the sentence', () => {
    expect(playersStillNeeded(1, 1)).toBe(1);
    expect(groupLine(1, 'lfg', 1)).toBe('1 looking · needs 1 more');
  });

  it('reads "N looking to play" from two hands', () => {
    expect(groupLine(2, effectiveLfgState(2), 4)).toBe('2 looking to play');
    expect(groupLine(5, effectiveLfgState(5), null)).toBe('5 looking to play');
  });
});

describe('threadNameFor — the board title IS the chip sentence (AC9)', () => {
  it.each([
    [1, null, 'Final Fantasy XIV Online · 1 looking · needs 1 more'],
    [1, 4, 'Final Fantasy XIV Online · 1 looking · needs 3 more'],
    [2, 4, 'Final Fantasy XIV Online · 2 looking to play'],
    [3, null, 'Final Fantasy XIV Online · 3 looking to play'],
  ])(
    'at %i hands, threshold %s',
    (memberCount, viabilityThreshold, expected) => {
      const v = view({ memberCount, viabilityThreshold });
      expect(threadNameFor(v)).toBe(expected);
      expect(threadNameFor(v)).toBe(
        `${v.gameName} · ${groupLine(
          memberCount,
          effectiveLfgState(memberCount),
          viabilityThreshold,
        )}`,
      );
    },
  );
});
