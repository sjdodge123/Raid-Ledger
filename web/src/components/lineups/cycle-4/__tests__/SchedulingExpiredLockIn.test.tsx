/**
 * ROK-1610 — an expired poll can still be finished.
 *
 * The operator's Valheim poll expired with five of twelve votes on a time
 * that is still weeks away, and the page offered nothing but "start a new
 * poll". These cases pin the way out:
 *   - the organiser (`canLockIn`) gets a "Schedule <time>" primary on the
 *     expired banner, naming the server-chosen `lockInSlotId`;
 *   - a member on the same poll keeps today's expired copy and no action;
 *   - confirming names who gets signed up and writes through the
 *     create-event-from-slot mutation with THAT slot id;
 *   - and no row ever offers "Lock this time →" on a time that has passed
 *     (the operator saw one; the server refuses it).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupedMatchesResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

const createEventMutate = vi.fn();

vi.mock('../../../../hooks/use-scheduling', () => ({
  // ROK-1617 follow-up: the ladder presses through `mutateAsync`.
  useToggleScheduleVote: () => ({
    mutateAsync: vi.fn(() => new Promise<never>(() => {})),
    isPending: false,
  }),
  useSuggestSlot: () => ({ mutate: vi.fn(), isPending: false }),
  useMatchAvailability: () => ({ data: undefined, isLoading: false }),
  useCancelSchedulePoll: () => ({ mutate: vi.fn(), isPending: false }),
  useRemindVoters: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
  }),
  useCreateEventFromSlot: () => ({
    mutate: createEventMutate,
    isPending: false,
  }),
}));

const lineupMatchesData = vi.fn<[], GroupedMatchesResponseDto | undefined>(
  () => undefined,
);
vi.mock('../../../../hooks/use-lineup-matches', () => ({
  useLineupMatches: () => ({ data: lineupMatchesData(), isLoading: false }),
}));

const authUser = vi.fn<[], { id: number; role?: string } | null>(() => ({
  id: 99,
}));
vi.mock('../../../../hooks/use-auth', () => ({
  useAuth: () => ({ user: authUser(), isAuthenticated: true }),
  isOperatorOrAdmin: (u: { role?: string } | null) =>
    u?.role === 'operator' || u?.role === 'admin',
}));

vi.mock('../../../../lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../lib/api-client')>()),
  getSchedulePoll: vi.fn(),
}));

import { SchedulingComposite } from '../SchedulingComposite';
import { ME, buildPoll, type PollOverrides } from './scheduling-poll-fixtures';

/** The fixture's first slot — the future, voted one the server would pick. */
const LOCK_IN_SLOT_ID = 1001;

/** Render an EXPIRED poll with the ROK-1610 fields the server derives. */
function renderExpired(overrides: PollOverrides = {}): void {
  const poll = buildPoll({
    pollStatus: 'closed',
    canLockIn: true,
    lockInSlotId: LOCK_IN_SLOT_ID,
    ...overrides,
  });
  renderWithProviders(
    <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  authUser.mockReturnValue({ id: ME, role: 'operator' });
});

describe('SchedulingComposite — finishing an expired poll (ROK-1610)', () => {
  it('AC1 — the organiser gets a "Schedule <time>" action naming the slot', async () => {
    renderExpired();

    const action = await screen.findByTestId('expired-lock-in-action');
    expect(action).toHaveTextContent(/^Schedule .+/);
    // The time it names is the server's lockInSlotId, not the first row.
    expect(action.textContent).toContain('Jun');
  });

  it('AC3 — a member sees the expired copy and no schedule action', async () => {
    authUser.mockReturnValue({ id: 2 });
    renderExpired({ canLockIn: false, lockInSlotId: null });

    await screen.findByTestId('read-only-banner');
    expect(screen.queryByTestId('expired-lock-in-action')).toBeNull();
    expect(
      screen.getByText(/Start a new poll from the game/i),
    ).toBeInTheDocument();
  });

  it('AC2 — no schedule action when no future slot is lockable', async () => {
    renderExpired({ canLockIn: false, lockInSlotId: null });

    await screen.findByTestId('read-only-banner');
    expect(screen.queryByTestId('expired-lock-in-action')).toBeNull();
  });

  it('the confirm names who gets signed up', async () => {
    const user = userEvent.setup();
    renderExpired();

    await user.click(await screen.findByTestId('expired-lock-in-action'));

    const dialog = await screen.findByRole('dialog');
    // Slot 1001 carries one vote (the viewer) on a two-member poll.
    expect(dialog).toHaveTextContent(
      '1 of 2 picked this time — they get signed up and a Discord card.',
    );
    expect(
      screen.getByRole('button', { name: 'Schedule it' }),
    ).toBeInTheDocument();
  });

  it('confirming writes through the lock-in mutation with lockInSlotId', async () => {
    const user = userEvent.setup();
    renderExpired();

    await user.click(await screen.findByTestId('expired-lock-in-action'));
    await user.click(screen.getByRole('button', { name: 'Schedule it' }));

    await waitFor(() => expect(createEventMutate).toHaveBeenCalledTimes(1));
    expect(createEventMutate.mock.calls[0][0]).toEqual({
      lineupId: 7,
      matchId: 500,
      slotId: LOCK_IN_SLOT_ID,
    });
  });

  it('cancelling the confirm writes nothing', async () => {
    const user = userEvent.setup();
    renderExpired();

    await user.click(await screen.findByTestId('expired-lock-in-action'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createEventMutate).not.toHaveBeenCalled();
  });
});

describe('SchedulingSlotList — no lock on a time that has passed (ROK-1610)', () => {
  it('an open poll offers "Lock this time →" only on future slots', async () => {
    const poll = buildPoll();
    poll.slots[1] = {
      ...poll.slots[1],
      proposedTime: '2020-01-02T20:00:00.000Z',
    };
    renderWithProviders(
      <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId('schedule-slot')).toHaveLength(2),
    );
    const rows = screen.getAllByTestId('schedule-slot');
    const pastRow = rows.find((r) => r.textContent?.includes('· past'));
    const futureRow = rows.find((r) => r !== pastRow);
    expect(pastRow).toBeDefined();
    expect(
      within(pastRow!).queryByRole('button', { name: /lock this time/i }),
    ).toBeNull();
    expect(
      within(futureRow!).getByRole('button', { name: /lock this time/i }),
    ).toBeInTheDocument();
  });

  it('an expired poll locks ONLY the slot the server named (review P2)', async () => {
    // Both fixture slots are in the future; only 1001 carries a vote, so
    // locking 1002 in would create an event with an empty roster.
    renderExpired();

    await waitFor(() =>
      expect(screen.getAllByTestId('schedule-slot')).toHaveLength(2),
    );
    const rows = screen.getAllByTestId('schedule-slot');
    const lockable = rows.find(
      (r) => r.getAttribute('data-slot-id') === String(LOCK_IN_SLOT_ID),
    );
    const voteless = rows.find((r) => r !== lockable);
    expect(
      within(lockable!).getByRole('button', { name: /lock this time/i }),
    ).toBeInTheDocument();
    expect(
      within(voteless!).queryByRole('button', { name: /lock this time/i }),
    ).toBeNull();
  });

  it('a member never sees a row lock on an expired poll', async () => {
    authUser.mockReturnValue({ id: 2 });
    renderExpired({ canLockIn: false, lockInSlotId: null });

    await screen.findByTestId('read-only-banner');
    expect(screen.queryAllByRole('button', { name: /lock this time/i })).toEqual(
      [],
    );
  });
});

describe('SchedulingComposite — all times passed, deadline ahead (review P2)', () => {
  it('keeps the suggest affordance and the card\'s own wording', async () => {
    renderExpired({
      canLockIn: false,
      lockInSlotId: null,
      canVote: false,
      canSuggest: true,
    });

    await screen.findByTestId('read-only-banner');
    expect(
      screen.getByTestId('scheduling-find-better-time'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('expired-banner-next-step')).toHaveTextContent(
      /suggest a new time/i,
    );
    // Voting is still closed — that half of the rule is unchanged.
    expect(screen.queryAllByRole('button', { name: /^\+ Vote/ })).toEqual([]);
  });

  it('withholds it once the DEADLINE itself has passed', async () => {
    renderExpired({
      canLockIn: false,
      lockInSlotId: null,
      canVote: false,
      canSuggest: false,
    });

    await screen.findByTestId('read-only-banner');
    expect(screen.queryByTestId('scheduling-find-better-time')).toBeNull();
    expect(screen.getByTestId('expired-banner-next-step')).toHaveTextContent(
      /Start a new poll from the game/i,
    );
  });
});
