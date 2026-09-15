/**
 * Tests for GameTimeRefreshModal (ROK-1301 → ROK-1564).
 *
 * ROK-1564 turns the overlay into ONE question with FOUR answers (spike §d,
 * wireframe `dev/scheduling-wireframes/OptionACompPanel.tsx`). The week painter
 * (`GameTimeGrid`) NEVER renders inside the overlay again:
 *  - the prompt reads "Your game time is N days old. Anything changed?", or
 *    "You haven't set a game time yet. Anything to add?" when never confirmed
 *  - "Looks right" → useConfirmGameTime().mutate() (confirm-only save)
 *  - "I'm away some days" → reveals <AbsenceSection /> inline (aria-expanded)
 *  - "Edit my week" → a Link OUT to the profile editor carrying ?return=<path>
 *  - "Skip" → setWizardSkipped() + dismiss (unchanged)
 * The shell is a Modal ≥768px and the same body in a BottomSheet below it.
 *
 * These tests mock the data/mutation hooks + the absence child so they exercise
 * the overlay's own gating/copy/wiring in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createTestQueryClient } from '../../test/render-helpers';
import { GameTimeRefreshModal } from './GameTimeRefreshModal';

// --- Mock the game-time query + confirm mutation hooks ---
const mockUseGameTime = vi.fn();
const mockConfirmMutate = vi.fn();
const mockUseConfirmGameTime = vi.fn(() => ({ mutate: mockConfirmMutate, isPending: false }));
vi.mock('../../hooks/use-game-time', () => ({
  GAME_TIME_QUERY_KEY: ['me', 'game-time'],
  GAME_TIME_ABSENCES_KEY: ['me', 'game-time', 'absences-all'],
  useGameTime: (...args: unknown[]) => mockUseGameTime(...args),
  useConfirmGameTime: () => mockUseConfirmGameTime(),
  useCreateAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
  useGameTimeAbsences: vi.fn(() => ({ data: [] })),
}));

// --- Mock the absence child to keep the test focused on the overlay ---
vi.mock('../../components/features/game-time/game-time-absence', () => ({
  AbsenceSection: () => <div data-testid="absence-section">AbsenceSection</div>,
}));

// --- Viewport branch (Modal ≥768px vs BottomSheet below) ---
const mockIsDesktop = vi.fn(() => true);
vi.mock('../../hooks/use-media-query', () => ({
  useMediaQuery: () => mockIsDesktop(),
}));

// --- Mock the wizard skip util (sessionStorage gate) ---
const mockIsWizardSkipped = vi.fn(() => false);
const mockSetWizardSkipped = vi.fn();
vi.mock('./scheduling-wizard-utils', () => ({
  isWizardSkipped: () => mockIsWizardSkipped(),
  setWizardSkipped: () => mockSetWizardSkipped(),
}));

/** Build the useGameTime() return (composite-view DTO subset we depend on). */
function gameTimeQuery(opts: {
  stale: boolean;
  slots?: Array<{ dayOfWeek: number; hour: number }>;
  ageDays?: number | null;
}) {
  return {
    data: {
      slots: opts.slots ?? [],
      gameTimeStale: opts.stale,
      gameTimeAgeDays: opts.ageDays === undefined ? 9 : opts.ageDays,
    },
    isLoading: false,
  };
}

const SAVED_SLOTS = [{ dayOfWeek: 1, hour: 19 }, { dayOfWeek: 3, hour: 20 }];
const POLL_PATH = '/lineups/42/scheduling';

/** Reset every mock to the default "stale desktop viewer" baseline. */
function resetMocks(): void {
  vi.clearAllMocks();
  mockIsWizardSkipped.mockReturnValue(false);
  mockIsDesktop.mockReturnValue(true);
  mockUseConfirmGameTime.mockReturnValue({ mutate: mockConfirmMutate, isPending: false });
  mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS }));
}

describe('GameTimeRefreshModal — gating', () => {
  beforeEach(resetMocks);

  it('renders when gameTimeStale is true and not session-skipped', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-check-body')).toBeInTheDocument();
  });

  it('does NOT render when gameTimeStale is false', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: false, slots: SAVED_SLOTS }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-body')).not.toBeInTheDocument();
  });

  it('does NOT render even when stale if the wizard is session-skipped', () => {
    mockIsWizardSkipped.mockReturnValue(true);
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never renders the week painter inside the overlay (AC: editor moved out)', () => {
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — the one question', () => {
  beforeEach(resetMocks);

  it('asks "Your game time is N days old. Anything changed?" when it has an age', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS, ageDays: 12 }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByTestId('game-time-check-prompt')).toHaveTextContent(
      'Your game time is 12 days old. Anything changed?',
    );
  });

  it('asks "You haven\'t set a game time yet. Anything to add?" when never confirmed', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: [], ageDays: null }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByTestId('game-time-check-prompt')).toHaveTextContent(
      "You haven't set a game time yet. Anything to add?",
    );
  });

  it('asks "hasn\'t been confirmed yet" when the viewer HAS slots but never confirmed (pre-ROK-999 data)', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS, ageDays: null }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByTestId('game-time-check-prompt')).toHaveTextContent(
      "Your game time hasn't been confirmed yet. Anything changed?",
    );
  });
});

describe('GameTimeRefreshModal — answer 1: Looks right', () => {
  beforeEach(resetMocks);

  it('calls the confirm mutation and closes once staleness clears', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<GameTimeRefreshModal />);

    await user.click(screen.getByTestId('game-time-check-confirm'));
    expect(mockConfirmMutate).toHaveBeenCalledTimes(1);

    // The confirm invalidates game time; the refetch returns stale=false → the
    // overlay closes on its own via the derived `open`.
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: false, slots: SAVED_SLOTS }));
    rerender(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stays open when the confirm does not clear staleness (failed confirm → retry)', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<GameTimeRefreshModal />);
    await user.click(screen.getByTestId('game-time-check-confirm'));
    expect(mockConfirmMutate).toHaveBeenCalledTimes(1);
    // The refetch still says stale (the write failed server-side) → the derived
    // `open` stays true and the answer is offered again, not swallowed.
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS }));
    rerender(<GameTimeRefreshModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-check-confirm')).toBeEnabled();
  });

  it('disables "Looks right" while the confirm is in flight', () => {
    mockUseConfirmGameTime.mockReturnValue({ mutate: mockConfirmMutate, isPending: true });
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByTestId('game-time-check-confirm')).toBeDisabled();
  });
});

describe('GameTimeRefreshModal — answer 2: I am away some days', () => {
  beforeEach(resetMocks);

  it('reveals the absence section inline and flips aria-expanded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GameTimeRefreshModal />);

    const answer = screen.getByTestId('game-time-check-absence');
    expect(answer).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('absence-section')).not.toBeInTheDocument();

    await user.click(answer);
    expect(answer).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('absence-section')).toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — answer 3: Edit my week', () => {
  beforeEach(resetMocks);

  it('links OUT to the profile editor carrying ?return=<current poll path>', () => {
    renderWithProviders(<GameTimeRefreshModal />, { initialEntries: [POLL_PATH] });
    const link = screen.getByTestId('game-time-check-edit');
    expect(link).toHaveAttribute(
      'href',
      `/profile/gaming/game-time?return=${encodeURIComponent(POLL_PATH)}`,
    );
  });
});

describe('GameTimeRefreshModal — answer 4: Skip', () => {
  beforeEach(resetMocks);

  it('closes the overlay and persists setWizardSkipped()', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GameTimeRefreshModal />);
    await user.click(screen.getByTestId('game-time-check-skip'));
    expect(mockSetWizardSkipped).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — viewport shell (ROK-1574: desktop only)', () => {
  beforeEach(resetMocks);

  it('renders a Modal at ≥768px', () => {
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByTestId('game-time-check-body')).toHaveAttribute('data-surface', 'modal');
  });

  it('renders NOTHING below 768px — the composite\'s two-step sheet owns the phone', () => {
    mockIsDesktop.mockReturnValue(false);
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-body')).not.toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — staleness arriving after mount', () => {
  beforeEach(resetMocks);

  it('opens when gameTimeStale flips true after mount (cached-fresh → refetch to stale)', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: false, slots: SAVED_SLOTS }));
    const { rerender } = renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS }));
    rerender(<GameTimeRefreshModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — cache invalidation on confirm', () => {
  beforeEach(resetMocks);

  it('leaves the ladder alone: the overlay itself invalidates nothing on open', () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderWithProviders(<GameTimeRefreshModal />, { queryClient });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
