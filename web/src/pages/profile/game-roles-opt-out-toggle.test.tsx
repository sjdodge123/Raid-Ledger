/**
 * ROK-1767 (L3): the profile "Auto game roles" switch and its hook, which
 * writes the `discord_game_roles_opt_out` preference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GAME_ROLES_OPT_OUT_PREF_KEY } from '@raid-ledger/contract';
import { GameRolesOptOutToggle } from './game-roles-opt-out-toggle';
import { useGameRolesOptOut } from './identity-hooks';

const prefs = { current: {} as Record<string, unknown> };
const updatePreference = vi.fn((_k: string, _v: unknown) => Promise.resolve());
vi.mock('../../lib/api-client', () => ({
    getMyPreferences: () => Promise.resolve(prefs.current),
    updatePreference: (k: string, v: unknown) => updatePreference(k, v),
}));
vi.mock('../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('GameRolesOptOutToggle (ROK-1767)', () => {
    beforeEach(() => { vi.clearAllMocks(); prefs.current = {}; });

    it('renders the switch on and reports the new state when pressed', () => {
        const onToggle = vi.fn();
        render(<GameRolesOptOutToggle enabled onToggle={onToggle} isPending={false} />);
        const sw = screen.getByRole('switch', { name: 'Auto game roles' });
        expect(sw).toBeChecked();
        fireEvent.click(sw);
        expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('turning auto game roles off writes the opt-out pref as true', async () => {
        const { result } = renderHook(() => useGameRolesOptOut(true, true), { wrapper });
        expect(result.current.gameRolesEnabled).toBe(true);
        act(() => result.current.toggleGameRoles(false));
        await waitFor(() => expect(updatePreference).toHaveBeenCalledWith(GAME_ROLES_OPT_OUT_PREF_KEY, true));
    });

    it('reads a stored opt-out as switched off', async () => {
        prefs.current = { [GAME_ROLES_OPT_OUT_PREF_KEY]: true };
        const { result } = renderHook(() => useGameRolesOptOut(true, true), { wrapper });
        await waitFor(() => expect(result.current.gameRolesEnabled).toBe(false));
    });
});
