/**
 * ROK-1192 — failing TDD test for CreatePollModal duration picker.
 *
 * Frontend AC #1:
 *   - The create-poll modal renders a duration picker (24h / 48h / 72h /
 *     7d) defaulted to 72.
 *   - When the user submits, `useCreateSchedulingPoll().mutateAsync` is
 *     called with `durationHours: 72` (default) — and with the picked
 *     value when the user changes it.
 *
 * Today the modal sends `{ gameId, memberUserIds, minVoteThreshold }`
 * with NO `durationHours`. These tests must FAIL until the dev wires the
 * picker through `useCreatePollForm` into the mutation payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { CreatePollModal } from './create-poll-modal';

vi.mock('../../hooks/use-standalone-poll', () => ({
  useCreateSchedulingPoll: vi.fn(),
}));

vi.mock('../../lib/api-client', () => ({
  getPlayers: vi.fn(),
}));

vi.mock('../../hooks/use-game-search', () => ({
  useGameSearch: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>(
    'react-router-dom',
  );
  return { ...actual, useNavigate: () => vi.fn() };
});

import { useCreateSchedulingPoll } from '../../hooks/use-standalone-poll';
import { getPlayers } from '../../lib/api-client';
import { useGameSearch } from '../../hooks/use-game-search';

const mutateAsync = vi.fn();

const fakeGame: IgdbGameDto = {
  id: 9001,
  name: 'Civ VI',
  slug: 'civ-vi',
  coverUrl: null,
  releaseDate: null,
  summary: null,
  igdbId: null,
  // Some required-by-zod fields the contract type may demand at runtime
  // are not strictly needed by the modal's selection flow, so we fill a
  // minimum-shape that the component reads.
} as unknown as IgdbGameDto;

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ id: 1, lineupId: 2 });
  vi.mocked(useCreateSchedulingPoll).mockReturnValue({
    mutateAsync,
    isPending: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCreateSchedulingPoll>);
  vi.mocked(getPlayers).mockResolvedValue({
    data: [
      { id: 10, username: 'alice', avatar: null, discordId: 'd-10' },
      { id: 11, username: 'bob', avatar: null, discordId: null },
    ],
    meta: { total: 2, page: 1, pageSize: 20, hasMore: false },
  } as unknown as Awaited<ReturnType<typeof getPlayers>>);
  vi.mocked(useGameSearch).mockReturnValue({
    data: { data: [fakeGame] },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useGameSearch>);
});

/** Pick `fakeGame` in the search box so the Create Poll button enables. */
async function pickFakeGame(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByTestId('game-search-input');
  await user.type(input, 'Ci');
  // The dropdown renders one game from useGameSearch — click it.
  const option = await screen.findByText(fakeGame.name);
  await user.click(option);
}

/** The Voting window radiogroup (ROK-1650: RadioGroup segmented, not bespoke sr-only cards). */
function votingWindow(): HTMLElement {
  return screen.getByRole('radiogroup', { name: 'Voting window' });
}

describe('CreatePollModal — duration picker (ROK-1192)', () => {
  it('renders a duration picker with options 24h / 48h / 72h / 7d', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    const picker = screen.getByTestId('poll-duration-picker');
    const radios = within(picker).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['24', '48', '72', '168']);
    for (const name of ['24 hours', '48 hours', '72 hours', '7 days']) {
      expect(within(picker).getByRole('radio', { name })).toBeInTheDocument();
    }
  });

  it('defaults the duration picker to 72 hours', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByRole('radio', { name: '72 hours' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '7 days' })).not.toBeChecked();
  });

  it('sends durationHours: 72 in the mutation payload by default', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    await pickFakeGame(user);
    await user.click(screen.getByRole('button', { name: /create poll/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ gameId: fakeGame.id, durationHours: 72 });
  });

  it('sends durationHours: 168 when the user picks "7 days"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    await pickFakeGame(user);
    await user.click(within(votingWindow()).getByRole('radio', { name: '7 days' }));
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: /create poll/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ gameId: fakeGame.id, durationHours: 168 });
  });
});

describe('CreatePollModal — Voting window RadioGroup (ROK-1650)', () => {
  it('is a radiogroup named "Voting window" inside the poll-duration-picker wrapper', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    const group = votingWindow();
    expect(screen.getByTestId('poll-duration-picker')).toContainElement(group);
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
  });

  it('shows no required asterisk and is not aria-required (ruling 8: it always has a value)', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    const group = votingWindow();
    expect(group).not.toHaveAttribute('aria-required');
    expect(within(group).queryByText('*')).toBeNull();
  });

  it('uses no raw emerald classes (ruling 9: tokens only)', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('poll-duration-picker').querySelector('[class*="emerald"]')).toBeNull();
    expect(screen.getByTestId('min-vote-threshold-slider').querySelector('[class*="emerald"]')).toBeNull();
  });
});

/** Tick two members so the threshold syncs to 2 and the slider max becomes 2. */
async function pickTwoMembers(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('member-option-10'));
  await user.click(await screen.findByTestId('member-option-11'));
}

describe('CreatePollModal — Minimum Votes Slider (ROK-1650)', () => {
  it('is a slider named "Minimum Votes" whose aria-valuetext reads "N of M"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    await pickTwoMembers(user);
    const slider = screen.getByRole('slider', { name: 'Minimum Votes' });
    expect(slider).toHaveAttribute('aria-valuetext', '2 of 2');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(slider).toHaveAttribute('aria-valuetext', '1 of 2');
  });

  it('keeps the wrapper testid with min/max on its inner input[type=range] (smoke selector)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    await pickTwoMembers(user);
    const input = screen.getByTestId('min-vote-threshold-slider').querySelector('input[type="range"]');
    expect(input).toBe(screen.getByRole('slider', { name: 'Minimum Votes' }));
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '2');
  });

  it('submits the slider value as minVoteThreshold', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    await pickFakeGame(user);
    await pickTwoMembers(user);
    fireEvent.change(screen.getByRole('slider', { name: 'Minimum Votes' }), { target: { value: '1' } });
    await user.click(screen.getByRole('button', { name: /create poll/i }));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ memberUserIds: [10, 11], minVoteThreshold: 1 });
  });
});

/** Re-mock the create mutation as in flight. */
function mockPending() {
  vi.mocked(useCreateSchedulingPoll).mockReturnValue({
    mutateAsync, isPending: true, isError: false, error: null,
  } as unknown as ReturnType<typeof useCreateSchedulingPoll>);
}

/*
 * Ruling 7: Button `loading` replaces the visible "Creating..." text with a
 * spinner and an sr-only loadingLabel. The old native-disabled pending state
 * is asserted as aria-disabled + aria-busy + a swallowed click — equivalent
 * strength, not weakened.
 */
describe('CreatePollModal — Create Poll loading state (ROK-1650, ruling 7)', () => {
  it('while pending the button is aria-busy + aria-disabled, named "Creating…", and swallows clicks', async () => {
    mockPending();
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    await pickFakeGame(user);
    const button = screen.getByRole('button', { name: 'Creating…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(within(button).getByTestId('button-spinner')).toBeInTheDocument();
    await user.click(button);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('is not busy when idle and stays natively disabled until a game is picked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Create Poll' });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
    await pickFakeGame(user);
    expect(button).toBeEnabled();
  });
});
