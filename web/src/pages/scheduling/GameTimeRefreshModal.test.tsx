/**
 * Tests for GameTimeRefreshModal (ROK-1301).
 *
 * The weekly-availability painter moves out of SchedulingWizard Step 1 into a
 * self-gating modal mounted on the scheduling poll page. The modal:
 *  - auto-opens iff gameTimeStale === true AND the wizard isn't session-skipped
 *  - shows a "Set your Game Time" title for fresh users (no saved slots) and a
 *    "Refresh your Game Time" title for stale returning users (have saved slots)
 *  - on Save: closes + invalidates BOTH ['scheduling'] and GAME_TIME_QUERY_KEY
 *  - on Skip: closes + persists setWizardSkipped()
 *
 * These tests mock the data/editor hooks + the grid/absence children so they
 * exercise the modal's own gating + title + Save/Skip wiring in isolation,
 * following the pattern in onboarding/gametime-step.test.tsx and
 * features/game-time/GameTimePanel.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createTestQueryClient } from '../../test/render-helpers';
import { GameTimeRefreshModal } from './GameTimeRefreshModal';

// --- Mock the game-time query hook (controls gameTimeStale + saved slots) ---
// Also stub GAME_TIME_QUERY_KEY (the modal invalidates it on save) and the
// absence hooks the embedded AbsenceSection would otherwise call.
const mockUseGameTime = vi.fn();
vi.mock('../../hooks/use-game-time', () => ({
  GAME_TIME_QUERY_KEY: ['me', 'game-time'],
  GAME_TIME_ABSENCES_KEY: ['me', 'game-time', 'absences-all'],
  useGameTime: (...args: unknown[]) => mockUseGameTime(...args),
  useCreateAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
  useGameTimeAbsences: vi.fn(() => ({ data: [] })),
}));

// --- Mock the editor hook (slot state + save) ---
const mockSave = vi.fn().mockResolvedValue(undefined);
const mockEditor = {
  slots: [],
  handleChange: vi.fn(),
  save: mockSave,
  isLoading: false,
  isDirty: true,
  isSaving: false,
  tzLabel: 'UTC',
};
vi.mock('../../hooks/use-game-time-editor', () => ({
  useGameTimeEditor: vi.fn(() => mockEditor),
}));

// --- Mock the heavy grid + absence children to keep the test focused ---
vi.mock('../../components/features/game-time/GameTimeGrid', () => ({
  GameTimeGrid: () => <div data-testid="game-time-grid">GameTimeGrid</div>,
}));
vi.mock('../../components/features/game-time/game-time-absence', () => ({
  AbsenceSection: () => <div data-testid="absence-section">AbsenceSection</div>,
}));

// --- Mock the wizard skip util (sessionStorage gate) ---
const mockIsWizardSkipped = vi.fn(() => false);
const mockSetWizardSkipped = vi.fn();
vi.mock('./scheduling-wizard-utils', () => ({
  isWizardSkipped: () => mockIsWizardSkipped(),
  setWizardSkipped: () => mockSetWizardSkipped(),
}));

/**
 * Build the useGameTime() return.
 *
 * The composite-view DTO (GameTimeResponse) exposes ONLY `gameTimeStale: boolean`
 * — there is NO `gameTimeConfirmedAt` field (per Lead, 2026-06-02). The
 * fresh-vs-returning distinction is therefore driven by whether the user already
 * has saved slots: "fresh" = stale + no slots; "stale returning" = stale + slots.
 */
function gameTimeQuery(opts: { stale: boolean; slots?: Array<{ dayOfWeek: number; hour: number }> }) {
  return {
    data: {
      slots: opts.slots ?? [],
      gameTimeStale: opts.stale,
    },
    isLoading: false,
  };
}

const SAVED_SLOTS = [{ dayOfWeek: 1, hour: 19 }, { dayOfWeek: 3, hour: 20 }];

describe('GameTimeRefreshModal — gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWizardSkipped.mockReturnValue(false);
  });

  it('renders the modal when gameTimeStale is true and not session-skipped', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-grid')).toBeInTheDocument();
  });

  it('does NOT render the modal when gameTimeStale is false', () => {
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: false, slots: SAVED_SLOTS }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
  });

  it('does NOT render even when stale if the wizard is session-skipped', () => {
    mockIsWizardSkipped.mockReturnValue(true);
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true }));
    renderWithProviders(<GameTimeRefreshModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — title varies by fresh vs stale-returning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWizardSkipped.mockReturnValue(false);
    mockEditor.slots = [];
  });

  it('fresh user (no saved slots) → "Set your Game Time" title', () => {
    // Fresh = stale gate fires AND the user has never saved any slots.
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: [] }));
    mockEditor.slots = [];
    renderWithProviders(<GameTimeRefreshModal />);
    // Stable substring only — the exact "set so the group can plan" tail may change.
    expect(screen.getByText(/set your game time/i)).toBeInTheDocument();
  });

  it('stale returning user (has saved slots) → "Refresh your Game Time" title', () => {
    // Stale-returning = stale gate fires AND the user already has saved slots.
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS }));
    mockEditor.slots = SAVED_SLOTS;
    renderWithProviders(<GameTimeRefreshModal />);
    // Stable substring only — exact "Last set N days ago" sub-line is pending an
    // operator copy decision (no gameTimeConfirmedAt on the DTO), so don't assert it.
    expect(screen.getByText(/refresh your game time/i)).toBeInTheDocument();
  });
});

describe('GameTimeRefreshModal — Save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWizardSkipped.mockReturnValue(false);
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS }));
  });

  it('Save closes the modal and invalidates both ["scheduling"] and GAME_TIME_QUERY_KEY', async () => {
    const user = userEvent.setup();
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderWithProviders(<GameTimeRefreshModal />, { queryClient });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    await user.click(saveBtn);

    // editor.save() must run first.
    expect(mockSave).toHaveBeenCalled();

    // Both caches invalidated so the group heatmap on the same page refreshes.
    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(invalidatedKeys).toContain(JSON.stringify(['scheduling']));
    expect(invalidatedKeys).toContain(JSON.stringify(['me', 'game-time']));

    // Modal closes after a successful save.
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('GameTimeRefreshModal — Skip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsWizardSkipped.mockReturnValue(false);
    mockUseGameTime.mockReturnValue(gameTimeQuery({ stale: true, slots: SAVED_SLOTS }));
  });

  it('Skip closes the modal and persists setWizardSkipped()', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GameTimeRefreshModal />);

    const skipBtn = screen.getByRole('button', { name: /skip/i });
    await user.click(skipBtn);

    expect(mockSetWizardSkipped).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
