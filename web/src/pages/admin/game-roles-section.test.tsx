/**
 * ROK-1767 (L3): the Game roles admin card — rows, the per-row Switch, "Run
 * now", and the link dialog's preflight gate on Save.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { GameRolePreflightDto, GameRoleSummaryDto } from '@raid-ledger/contract';
import { GameRolesSection } from './game-roles-section';

const ROW: GameRoleSummaryDto = {
    gameId: 3, gameName: 'Valheim', roleId: 'r-1', roleName: 'Valheim', botCreated: true,
    windowDays: 14, enabled: true, lastReconciledAt: null, grantedCount: 5,
};
const PROBLEM: GameRolePreflightDto = {
    ok: false, problems: [{ code: 'role_above_bot', message: 'The bot role must sit above @Raiders.' }],
};

const state = {
    list: { data: [ROW] as GameRoleSummaryDto[] | undefined, isError: false },
    upsert: { mutate: vi.fn(), isPending: false, error: null as Error | null },
    remove: { mutate: vi.fn(), isPending: false },
    run: { mutate: vi.fn(), isPending: false },
    preflight: { data: undefined as GameRolePreflightDto | undefined },
    preflightVars: vi.fn(),
};
vi.mock('../../hooks/admin/use-game-roles', () => ({
    useGameRoles: () => state,
    useDiscordRoleOptions: () => ({ data: [{ id: 'r-9', name: 'Raiders', assignable: true }] }),
    useGameRolePreflight: (vars: unknown) => { state.preflightVars(vars); return state.preflight; },
    useGameRoleAudit: () => ({ data: [], isError: false }),
}));
vi.mock('../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../../components/events/game-search-input', () => ({
    GameSearchInput: ({ onChange }: { onChange: (g: unknown) => void }) => (
        <button type="button" onClick={() => onChange({ id: 7, igdbId: null, name: 'Hades', slug: 'hades', coverUrl: null })}>
            pick game
        </button>
    ),
}));
const toastSuccess = vi.fn();
vi.mock('../../lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

function openDialog() {
    render(<GameRolesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Link game' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick game' }));
    return screen.getByRole('dialog');
}

describe('GameRolesSection (ROK-1767 L3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.list = { data: [ROW], isError: false };
        state.preflight = { data: undefined };
        state.upsert.error = null;
    });

    it('renders a linked game with its role, window, granted count and last run', () => {
        render(<GameRolesSection />);
        const row = screen.getByTestId('game-role-row-3');
        expect(row).toHaveTextContent('Valheim');
        expect(row).toHaveTextContent('@Valheim');
        expect(row).toHaveTextContent('14-day window · 5 granted · Last run: Not run yet');
        expect(within(row).getByRole('switch', { name: 'Manage the Valheim role' })).toBeChecked();
    });

    it('the row Switch pauses the link, keeping the existing role id', () => {
        render(<GameRolesSection />);
        fireEvent.click(screen.getByRole('switch', { name: 'Manage the Valheim role' }));
        expect(state.upsert.mutate).toHaveBeenCalledWith(
            { gameId: 3, body: { roleId: 'r-1', windowDays: 14, enabled: false } }, expect.anything());
    });

    it('Run now calls the run mutation and toasts the result', () => {
        state.run.mutate.mockImplementation((_v: unknown, o: { onSuccess: (r: unknown) => void }) =>
            o.onSuccess({ added: 2, removed: 1, skippedOverCap: 0, failedGames: [] }));
        render(<GameRolesSection />);
        fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
        expect(state.run.mutate).toHaveBeenCalledWith(undefined, expect.anything());
        expect(toastSuccess).toHaveBeenCalledWith('Game roles synced: 2 added, 1 removed');
    });

    it('a failed preflight shows the danger banner and keeps Save disabled', () => {
        state.preflight = { data: PROBLEM };
        const dialog = openDialog();
        expect(within(dialog).getByTestId('game-role-preflight-banner')).toHaveTextContent('The bot role must sit above @Raiders.');
        expect(within(dialog).getByTestId('game-role-save')).toBeDisabled();
    });

    it('a clean preflight enables Save, which links the game with a bot-created role and the 14-day default', () => {
        state.preflight = { data: { ok: true, problems: [] } };
        const dialog = openDialog();
        expect(state.preflightVars).toHaveBeenLastCalledWith({ gameId: 7, roleId: null });
        expect(within(dialog).getByRole('option', { name: 'Create @Hades' })).toBeInTheDocument();
        fireEvent.click(within(dialog).getByTestId('game-role-save'));
        expect(state.upsert.mutate).toHaveBeenCalledWith(
            { gameId: 7, body: { roleId: null, windowDays: 14 } }, expect.anything());
    });

    it('shows the empty state when no game is linked', () => {
        state.list = { data: [], isError: false };
        render(<GameRolesSection />);
        expect(screen.getByText(/No games linked yet/)).toBeInTheDocument();
    });
});
