import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IgdbForm } from './IgdbForm';

// ============================================================
// Module mocks
// ============================================================

vi.mock('../../hooks/use-admin-settings', () => ({
    useAdminSettings: vi.fn(),
}));

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

import { useAdminSettings } from '../../hooks/use-admin-settings';
import { toast } from '../../lib/toast';

// ============================================================
// Helpers
// ============================================================

const makeHook = (overrides: Partial<ReturnType<typeof useAdminSettings>> = {}) => ({
    igdbStatus: { data: null, isLoading: false, isError: false } as any,
    updateIgdb: { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Saved' }), isPending: false } as any,
    testIgdb: { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Connected' }), isPending: false } as any,
    clearIgdb: { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Cleared' }), isPending: false } as any,
    igdbSyncStatus: { data: { lastSyncAt: null, gameCount: 0, syncInProgress: false }, isLoading: false } as any,
    syncIgdb: { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Synced', refreshed: 0, discovered: 0 }), isPending: false } as any,
    igdbAdultFilter: { data: { enabled: false }, isLoading: false } as any,
    updateAdultFilter: { mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Filter updated' }), isPending: false } as any,
    // Other settings not under test
    oauthStatus: { data: null, isLoading: false } as any,
    updateOAuth: { mutateAsync: vi.fn(), isPending: false } as any,
    testOAuth: { mutateAsync: vi.fn(), isPending: false } as any,
    clearOAuth: { mutateAsync: vi.fn(), isPending: false } as any,
    blizzardStatus: { data: null, isLoading: false } as any,
    updateBlizzard: { mutateAsync: vi.fn(), isPending: false } as any,
    testBlizzard: { mutateAsync: vi.fn(), isPending: false } as any,
    clearBlizzard: { mutateAsync: vi.fn(), isPending: false } as any,
    demoDataStatus: { data: null, isLoading: false } as any,
    installDemoData: { mutateAsync: vi.fn(), isPending: false } as any,
    clearDemoData: { mutateAsync: vi.fn(), isPending: false } as any,
    discordBotStatus: { data: null, isLoading: false } as any,
    updateDiscordBot: { mutateAsync: vi.fn(), isPending: false } as any,
    testDiscordBot: { mutateAsync: vi.fn(), isPending: false } as any,
    clearDiscordBot: { mutateAsync: vi.fn(), isPending: false } as any,
    checkDiscordBotPermissions: { mutateAsync: vi.fn(), isPending: false } as any,
    ...overrides,
});

// ============================================================
// Tests
// ============================================================

describe('IgdbForm — ROK-231: adult content filter toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useAdminSettings).mockReturnValue(makeHook());
    });

    // ---- Adult filter toggle (only visible when IGDB is configured) ----

    it('does NOT render the adult filter section when IGDB is not configured', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: false }, isLoading: false } as any,
        }));

        render(<IgdbForm />);

        expect(screen.queryByText(/Filter adult content/i)).not.toBeInTheDocument();
    });

    it('renders the adult filter section when IGDB is configured', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
        }));

        render(<IgdbForm />);

        expect(screen.getByText(/Filter adult content/i)).toBeInTheDocument();
    });

    it('renders the adult filter description', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
        }));

        render(<IgdbForm />);

        expect(screen.getByText(/erotic\/sexual themes/i)).toBeInTheDocument();
    });

    it('toggle switch has aria-checked=false when filter is disabled', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: false }, isLoading: false } as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('toggle switch has aria-checked=true when filter is enabled', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: true }, isLoading: false } as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('calls updateAdultFilter with true when toggled from off to on', async () => {
        const updateAdultFilter = {
            mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Enabled' }),
            isPending: false,
        };

        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: false }, isLoading: false } as any,
            updateAdultFilter: updateAdultFilter as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(updateAdultFilter.mutateAsync).toHaveBeenCalledWith(true);
        });
    });

    it('calls updateAdultFilter with false when toggled from on to off', async () => {
        const updateAdultFilter = {
            mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Disabled' }),
            isPending: false,
        };

        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: true }, isLoading: false } as any,
            updateAdultFilter: updateAdultFilter as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(updateAdultFilter.mutateAsync).toHaveBeenCalledWith(false);
        });
    });

    it('shows success toast after successfully toggling the filter', async () => {
        const updateAdultFilter = {
            mutateAsync: vi.fn().mockResolvedValue({ success: true, message: 'Adult content filter enabled.' }),
            isPending: false,
        };

        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: false }, isLoading: false } as any,
            updateAdultFilter: updateAdultFilter as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(toast.success).toHaveBeenCalledWith('Adult content filter enabled.');
        });
    });

    it('shows error toast when filter update fails', async () => {
        const updateAdultFilter = {
            mutateAsync: vi.fn().mockRejectedValue(new Error('Server error')),
            isPending: false,
        };

        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: false }, isLoading: false } as any,
            updateAdultFilter: updateAdultFilter as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Failed to update filter');
        });
    });

    it('disables the toggle when updateAdultFilter is pending', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
            igdbAdultFilter: { data: { enabled: false }, isLoading: false } as any,
            updateAdultFilter: { mutateAsync: vi.fn(), isPending: true } as any,
        }));

        render(<IgdbForm />);

        const toggle = screen.getByRole('switch');
        expect(toggle).toBeDisabled();
    });

    // ---- Form basics (not adult filter specific, but important regression tests) ----

    it('renders the save configuration button', () => {
        render(<IgdbForm />);
        expect(screen.getByRole('button', { name: /Save Configuration/i })).toBeInTheDocument();
    });

    it('shows error toast when saving with empty client id', async () => {
        render(<IgdbForm />);

        const submitButton = screen.getByRole('button', { name: /Save Configuration/i });
        fireEvent.click(submitButton);

        await waitFor(() => {
            expect(toast.error).toHaveBeenCalledWith('Client ID and Client Secret are required');
        });
    });

    it('shows test and clear buttons when IGDB is configured', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: true, health: null }, isLoading: false } as any,
        }));

        render(<IgdbForm />);
        expect(screen.getByRole('button', { name: /Test Connection/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Clear/i })).toBeInTheDocument();
    });

    it('does NOT show test and clear buttons when IGDB is not configured', () => {
        vi.mocked(useAdminSettings).mockReturnValue(makeHook({
            igdbStatus: { data: { configured: false }, isLoading: false } as any,
        }));

        render(<IgdbForm />);
        expect(screen.queryByRole('button', { name: /Test Connection/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Clear/i })).not.toBeInTheDocument();
    });
});
