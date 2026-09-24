import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IgdbForm } from './IgdbForm';

// Mock toast
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Shared mutable state for the hook mock
const mockIgdbStatus = {
    data: null as null | { configured: boolean; health?: unknown },
};

const mockIgdbSyncStatus = {
    data: null as null | { lastSyncAt: string | null; gameCount: number; syncInProgress: boolean },
};

const mockUpdateIgdb = { mutateAsync: vi.fn(), isPending: false };
const mockTestIgdb = { mutateAsync: vi.fn(), isPending: false };
const mockClearIgdb = { mutateAsync: vi.fn(), isPending: false };
const mockSyncIgdb = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../hooks/use-admin-settings', () => ({
    useAdminSettings: () => ({
        igdbStatus: mockIgdbStatus,
        updateIgdb: mockUpdateIgdb,
        testIgdb: mockTestIgdb,
        clearIgdb: mockClearIgdb,
        igdbSyncStatus: mockIgdbSyncStatus,
        syncIgdb: mockSyncIgdb,
        // Other fields not used by IgdbForm — provide safe no-ops
        oauthStatus: { data: null },
        updateOAuth: { mutateAsync: vi.fn(), isPending: false },
        testOAuth: { mutateAsync: vi.fn(), isPending: false },
        clearOAuth: { mutateAsync: vi.fn(), isPending: false },
        blizzardStatus: { data: null },
        updateBlizzard: { mutateAsync: vi.fn(), isPending: false },
        testBlizzard: { mutateAsync: vi.fn(), isPending: false },
        clearBlizzard: { mutateAsync: vi.fn(), isPending: false },
        demoDataStatus: { data: null },
        installDemoData: { mutateAsync: vi.fn(), isPending: false },
        clearDemoData: { mutateAsync: vi.fn(), isPending: false },
        discordBotStatus: { data: null },
        updateDiscordBot: { mutateAsync: vi.fn(), isPending: false },
        testDiscordBot: { mutateAsync: vi.fn(), isPending: false },
        clearDiscordBot: { mutateAsync: vi.fn(), isPending: false },
        checkDiscordBotPermissions: { mutateAsync: vi.fn(), isPending: false },
    }),
}));

/**
 * ROK-1652 ruling 7: a pending button is Button `loading` — aria-disabled +
 * aria-busy (focus stays), and it swallows clicks. Listed in the PR as the
 * equivalent of the old native toBeDisabled(), not a weakening: each case
 * below also clicks the button and proves the mutation never fires.
 */
function expectLoading(btn: HTMLElement) {
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
}

describe('IgdbForm — Form rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIgdbStatus.data = null;
        mockIgdbSyncStatus.data = null;
        mockUpdateIgdb.isPending = false;
        mockUpdateIgdb.mutateAsync = vi.fn();
        mockTestIgdb.isPending = false;
        mockTestIgdb.mutateAsync = vi.fn();
        mockClearIgdb.isPending = false;
        mockClearIgdb.mutateAsync = vi.fn();
        mockSyncIgdb.isPending = false;
        mockSyncIgdb.mutateAsync = vi.fn();
    });

    // ── Form rendering ───────────────────────────────────────────

    it('renders Client ID and Client Secret inputs', () => {
        render(<IgdbForm />);
        expect(screen.getByLabelText('Client ID')).toBeInTheDocument();
        expect(screen.getByLabelText('Client Secret')).toBeInTheDocument();
    });

    it('renders Save Configuration button', () => {
        render(<IgdbForm />);
        expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeInTheDocument();
    });

    it('renders setup instructions', () => {
        render(<IgdbForm />);
        expect(screen.getByText(/Setup Instructions/)).toBeInTheDocument();
    });

    it('renders Twitch Developer Console link', () => {
        render(<IgdbForm />);
        const link = screen.getByRole('link', { name: /Twitch Developer Console/ });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://dev.twitch.tv/console/apps');
    });

    // ── Save Configuration button state ─────────────────────────

    it('Save Configuration button is loading and swallows the submit when updateIgdb is pending', () => {
        mockUpdateIgdb.isPending = true;
        render(<IgdbForm />);
        fireEvent.change(screen.getByLabelText('Client ID'), { target: { value: 'client-id' } });
        fireEvent.change(screen.getByLabelText('Client Secret'), { target: { value: 'client-secret' } });
        const btn = screen.getByRole('button', { name: 'Saving...' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockUpdateIgdb.mutateAsync).not.toHaveBeenCalled();
    });

    it('keeps the smoke ids on the Client ID and Client Secret fields', () => {
        render(<IgdbForm />);
        expect(screen.getByLabelText('Client ID')).toHaveAttribute('id', 'igdbClientId');
        expect(screen.getByLabelText('Client Secret')).toHaveAttribute('id', 'igdbClientSecret');
    });

    it('names the Redirect URI field and its copy button', () => {
        render(<IgdbForm />);
        expect(screen.getByLabelText('Redirect URI')).toHaveValue('http://localhost');
        expect(screen.getByRole('button', { name: 'Copy Redirect URI' })).toBeInTheDocument();
    });

    it('renders the setup instructions as a neutral token panel', () => {
        render(<IgdbForm />);
        const panel = screen.getByText(/Setup Instructions/).closest('p')!.parentElement!;
        expect(panel).toHaveClass('bg-overlay/30', 'border-edge');
    });

    // ── Unconfigured state ───────────────────────────────────────

    it('does not show Test Connection button when not configured', () => {
        mockIgdbStatus.data = { configured: false };
        render(<IgdbForm />);
        expect(screen.queryByRole('button', { name: 'Test Connection' })).not.toBeInTheDocument();
    });

    it('does not show Clear button when not configured', () => {
        mockIgdbStatus.data = { configured: false };
        render(<IgdbForm />);
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });

    it('does not show sync section when not configured', () => {
        mockIgdbStatus.data = { configured: false };
        render(<IgdbForm />);
        expect(screen.queryByRole('button', { name: 'Sync Now' })).not.toBeInTheDocument();
    });

    // ── Configured state ─────────────────────────────────────────

});

describe('IgdbForm — Sync Now button', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIgdbStatus.data = null;
        mockIgdbSyncStatus.data = null;
        mockUpdateIgdb.isPending = false;
        mockUpdateIgdb.mutateAsync = vi.fn();
        mockTestIgdb.isPending = false;
        mockTestIgdb.mutateAsync = vi.fn();
        mockClearIgdb.isPending = false;
        mockClearIgdb.mutateAsync = vi.fn();
        mockSyncIgdb.isPending = false;
        mockSyncIgdb.mutateAsync = vi.fn();
    });

    it('shows Test Connection button when configured', () => {
        mockIgdbStatus.data = { configured: true };
        render(<IgdbForm />);
        expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument();
    });

    it('shows Clear button when configured', () => {
        mockIgdbStatus.data = { configured: true };
        render(<IgdbForm />);
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('Test Connection button is loading and swallows clicks when testIgdb is pending', () => {
        mockIgdbStatus.data = { configured: true };
        mockTestIgdb.isPending = true;
        render(<IgdbForm />);
        const btn = screen.getByRole('button', { name: 'Testing...' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(mockTestIgdb.mutateAsync).not.toHaveBeenCalled();
    });

    it('Clear button is loading and swallows clicks when clearIgdb is pending', () => {
        mockIgdbStatus.data = { configured: true };
        mockClearIgdb.isPending = true;
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<IgdbForm />);
        const btn = screen.getByRole('button', { name: 'Clear' });
        expectLoading(btn);
        fireEvent.click(btn);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(mockClearIgdb.mutateAsync).not.toHaveBeenCalled();
    });

    // ── Sync Now button ──────────────────────────────────────────

    it('Sync Now button is loading and swallows clicks when syncIgdb is pending', () => {
        mockIgdbStatus.data = { configured: true };
        mockIgdbSyncStatus.data = { lastSyncAt: null, gameCount: 0, syncInProgress: false };
        mockSyncIgdb.isPending = true;
        render(<IgdbForm />);
        const syncBtn = screen.getByRole('button', { name: 'Syncing...' });
        expectLoading(syncBtn);
        fireEvent.click(syncBtn);
        expect(mockSyncIgdb.mutateAsync).not.toHaveBeenCalled();
    });

    it('Sync Now button is disabled when syncInProgress is true', () => {
        mockIgdbStatus.data = { configured: true };
        mockIgdbSyncStatus.data = { lastSyncAt: null, gameCount: 42, syncInProgress: true };
        render(<IgdbForm />);
        const syncBtn = screen.getByRole('button', { name: 'Sync Now' });
        expect(syncBtn).toBeDisabled();
    });

    // ── Sync status display ──────────────────────────────────────

    it.each([
        ['valid', 'bg-success'],
        ['expired', 'bg-warning'],
        ['none', 'bg-dim'],
    ])('paints the %s token-status dot with %s', (tokenStatus, cls) => {
        mockIgdbStatus.data = { configured: true, health: { tokenStatus } };
        const { container } = render(<IgdbForm />);
        expect(container.querySelector('.w-2.h-2.rounded-full')).toHaveClass(cls);
    });

    it.each([
        [true, 'bg-success'],
        [false, 'bg-danger'],
    ])('paints the last-API-call dot (success=%s) with %s', (lastApiCallSuccess, cls) => {
        mockIgdbStatus.data = {
            configured: true,
            health: { tokenStatus: 'valid', lastApiCallAt: new Date().toISOString(), lastApiCallSuccess },
        };
        const { container } = render(<IgdbForm />);
        expect(container.querySelectorAll('.w-2.h-2.rounded-full')[1]).toHaveClass(cls);
    });

    it('shows game count from sync status', () => {
        mockIgdbStatus.data = { configured: true };
        mockIgdbSyncStatus.data = { lastSyncAt: null, gameCount: 123, syncInProgress: false };
        render(<IgdbForm />);
        expect(screen.getByText('123 games cached')).toBeInTheDocument();
    });

});

describe('IgdbForm — Password visibility toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIgdbStatus.data = null;
        mockIgdbSyncStatus.data = null;
        mockUpdateIgdb.isPending = false;
        mockUpdateIgdb.mutateAsync = vi.fn();
        mockTestIgdb.isPending = false;
        mockTestIgdb.mutateAsync = vi.fn();
        mockClearIgdb.isPending = false;
        mockClearIgdb.mutateAsync = vi.fn();
        mockSyncIgdb.isPending = false;
        mockSyncIgdb.mutateAsync = vi.fn();
    });

    it('shows Loading... when sync status data is null', () => {
        mockIgdbStatus.data = { configured: true };
        mockIgdbSyncStatus.data = null;
        render(<IgdbForm />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    // ── Password visibility toggle ───────────────────────────────

    it('Client Secret input is type=password by default', () => {
        render(<IgdbForm />);
        const secretInput = screen.getByLabelText('Client Secret');
        expect(secretInput).toHaveAttribute('type', 'password');
    });

    it('toggles Client Secret visibility when eye button is clicked', () => {
        render(<IgdbForm />);
        const secretInput = screen.getByLabelText('Client Secret') as HTMLInputElement;
        expect(secretInput.type).toBe('password');

        const toggleBtn = screen.getByRole('button', { name: 'Show password' });
        fireEvent.click(toggleBtn);
        expect(secretInput.type).toBe('text');
    });

    it('show/hide button label updates after toggle', () => {
        render(<IgdbForm />);
        const toggleBtn = screen.getByRole('button', { name: 'Show password' });
        fireEvent.click(toggleBtn);
        expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
    });

    // ── Form validation ──────────────────────────────────────────

    it('does not submit when Client ID is empty', async () => {
        render(<IgdbForm />);
        const form = screen.getByLabelText('Client ID').closest('form')!;
        fireEvent.submit(form);
        expect(mockUpdateIgdb.mutateAsync).not.toHaveBeenCalled();
    });

    // ── Confirm dialog on Clear ──────────────────────────────────

    it('does not call clearIgdb when confirm is cancelled', () => {
        mockIgdbStatus.data = { configured: true };
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<IgdbForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(mockClearIgdb.mutateAsync).not.toHaveBeenCalled();
    });

});
