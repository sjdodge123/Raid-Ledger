/**
 * ROK-1430 — `decideGame` unit matrix (spec §2.4 rows X1–X12, §2.12).
 * X11 / X12 are query-level (series and non-game bindings never reach the
 * decision as a candidate binding); here they reduce to "binding = null" and
 * the derivation integration spec (D12 / D13) asserts the query side.
 */
import type { LifecycleAction } from '@raid-ledger/contract';
import {
  decideGame,
  type DecideGameInput,
  type DecideSettings,
} from './channel-lifecycle.decide';
import type { LifecycleCandidateBinding } from './game-activity.queries';

const SETTINGS: DecideSettings = { createThreshold: 2, recentActivityDays: 30 };

function binding(
  over: Partial<LifecycleCandidateBinding> = {},
): LifecycleCandidateBinding {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    guildId: 'g1',
    channelId: 'c1',
    lifecycleState: 'active',
    autoManaged: true,
    pinned: false,
    archivedAt: null,
    restoreParentId: null,
    archivedOverwrites: null,
    ...over,
  };
}

function input(over: Partial<DecideGameInput> = {}): DecideGameInput {
  return {
    itemCount: 0,
    hubHold: false,
    hubNeedsLink: false,
    suppressed: false,
    binding: null,
    ...over,
  };
}

const ARCHIVED = { lifecycleState: 'archived' as const };

const CASES: ReadonlyArray<[string, DecideGameInput, LifecycleAction]> = [
  [
    'X1 no binding, items >= threshold → create',
    input({ itemCount: 2 }),
    'create',
  ],
  [
    'X1 hub hold does not block create',
    input({ itemCount: 3, hubHold: true }),
    'create',
  ],
  [
    'X2 no binding, below threshold, hub hold → create',
    input({ itemCount: 0, hubHold: true }),
    'create',
  ],
  ['X3 no binding, a single item → none', input({ itemCount: 1 }), 'none'],
  ['X3 no binding, zero items → none', input(), 'none'],
  [
    'X4 suppressed beats threshold',
    input({ itemCount: 5, suppressed: true }),
    'none',
  ],
  [
    'X4 suppressed beats hub hold',
    input({ hubHold: true, suppressed: true }),
    'none',
  ],
  [
    'X5 manual binding → none',
    input({ itemCount: 5, binding: binding({ autoManaged: false }) }),
    'none',
  ],
  [
    'X5 manual binding, quiet → never archived',
    input({ binding: binding({ autoManaged: false }) }),
    'none',
  ],
  [
    'X5 manual binding + hub needs a channel → link_hub',
    input({ hubNeedsLink: true, binding: binding({ autoManaged: false }) }),
    'link_hub',
  ],
  [
    'X6 auto active with activity → none',
    input({ itemCount: 1, binding: binding() }),
    'none',
  ],
  [
    'X6 auto active held by a hub → none',
    input({ hubHold: true, binding: binding() }),
    'none',
  ],
  [
    'X6 auto active + hub needs a channel → link_hub',
    input({ itemCount: 1, hubNeedsLink: true, binding: binding() }),
    'link_hub',
  ],
  [
    'X7 auto active, no activity, no hold → archive',
    input({ binding: binding() }),
    'archive',
  ],
  [
    'Codex r7 P1: auto active, quiet, channel shared with another binding → none',
    input({ binding: binding({ sharedWith: 1 }) }),
    'none',
  ],
  [
    'Codex r7 P1: a shared archived channel still unarchives on activity',
    input({ itemCount: 1, binding: binding({ ...ARCHIVED, sharedWith: 2 }) }),
    'unarchive',
  ],
  [
    'X8 auto archived with activity → unarchive',
    input({ itemCount: 1, binding: binding(ARCHIVED) }),
    'unarchive',
  ],
  [
    'X8 auto archived held by a hub → unarchive',
    input({ hubHold: true, binding: binding(ARCHIVED) }),
    'unarchive',
  ],
  [
    'X9 auto archived, no activity → none',
    input({ binding: binding(ARCHIVED) }),
    'none',
  ],
  [
    'X10 pinned active, no activity → none',
    input({ binding: binding({ pinned: true }) }),
    'none',
  ],
  [
    'X10 pinned archived with activity → none',
    input({ itemCount: 4, binding: binding({ ...ARCHIVED, pinned: true }) }),
    'none',
  ],
  [
    'X11 series-only (query maps to no binding) → create',
    input({ itemCount: 2, binding: null }),
    'create',
  ],
];

describe('decideGame — §2.4 matrix', () => {
  it.each(CASES)('%s', (_name, row, expected) => {
    expect(decideGame(row, SETTINGS).action).toBe(expected);
  });
});

describe('decideGame — threshold and reasons', () => {
  it('honours a raised threshold (3): two items do not create', () => {
    const t3: DecideSettings = { ...SETTINGS, createThreshold: 3 };
    expect(decideGame(input({ itemCount: 2 }), t3).action).toBe('none');
    expect(decideGame(input({ itemCount: 3 }), t3).action).toBe('create');
  });

  it('1 poll + 0 events never creates, and says how far off it is', () => {
    const out = decideGame(input({ itemCount: 1 }), SETTINGS);
    expect(out).toEqual({ action: 'none', reason: '1 of 2 activities' });
  });

  it('names suppression and pinning in the reason', () => {
    expect(
      decideGame(input({ itemCount: 9, suppressed: true }), SETTINGS).reason,
    ).toBe('suppressed');
    expect(
      decideGame(input({ binding: binding({ pinned: true }) }), SETTINGS)
        .reason,
    ).toBe('pinned');
  });

  it('archive reason carries the window length', () => {
    expect(decideGame(input({ binding: binding() }), SETTINGS).reason).toBe(
      'no activity in 30 days',
    );
  });

  it('never archives or unarchives a manual binding whatever the activity', () => {
    for (const itemCount of [0, 1, 10]) {
      for (const state of ['active', 'archived'] as const) {
        const row = input({
          itemCount,
          binding: binding({ autoManaged: false, lifecycleState: state }),
        });
        expect(['none', 'link_hub']).toContain(
          decideGame(row, SETTINGS).action,
        );
      }
    }
  });
});

it('Codex r7 P1: a shared quiet channel says why it is kept', () => {
  const res = decideGame(
    input({ binding: binding({ sharedWith: 2 }) }),
    SETTINGS,
  );
  expect(res).toEqual({
    action: 'none',
    reason: 'shared with 2 other bindings',
  });
});
