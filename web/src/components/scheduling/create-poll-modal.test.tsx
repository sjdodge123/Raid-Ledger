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
import { screen } from '@testing-library/react';
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

describe('CreatePollModal — duration picker (ROK-1192)', () => {
  it('renders a duration picker with options 24h / 48h / 72h / 7d', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);

    const picker = screen.getByTestId('poll-duration-picker');
    expect(picker).toBeInTheDocument();

    // Each option must be discoverable by accessible name.
    expect(
      screen.getByRole('radio', { name: /24 hours/i }) ??
        screen.getByRole('option', { name: /24 hours/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /48 hours/i }) ??
        screen.getByRole('option', { name: /48 hours/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /72 hours/i }) ??
        screen.getByRole('option', { name: /72 hours/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: /7 days/i }) ??
        screen.getByRole('option', { name: /7 days/i }),
    ).toBeTruthy();
  });

  it('defaults the duration picker to 72 hours', () => {
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);
    // The default-selected option should be the 72-hour one.
    const seventyTwo =
      screen.queryByRole('radio', { name: /72 hours/i, checked: true }) ??
      (screen.queryByLabelText(/72 hours/i) as HTMLInputElement | null);
    expect(seventyTwo).toBeTruthy();
    if (seventyTwo && 'checked' in seventyTwo) {
      expect((seventyTwo as HTMLInputElement).checked).toBe(true);
    }
  });

  it('sends durationHours: 72 in the mutation payload by default', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);

    await pickFakeGame(user);

    await user.click(screen.getByRole('button', { name: /create poll/i }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      gameId: fakeGame.id,
      durationHours: 72,
    });
  });

  it('sends durationHours: 168 when the user picks "7 days"', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreatePollModal isOpen={true} onClose={vi.fn()} />);

    await pickFakeGame(user);

    // The 7-day option may render as a radio or a labeled input — find by name.
    const sevenDay = (screen.queryByRole('radio', { name: /7 days/i }) ??
      screen.getByLabelText(/7 days/i)) as HTMLElement;
    await user.click(sevenDay);

    await user.click(screen.getByRole('button', { name: /create poll/i }));

    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      gameId: fakeGame.id,
      durationHours: 168,
    });
  });
});
