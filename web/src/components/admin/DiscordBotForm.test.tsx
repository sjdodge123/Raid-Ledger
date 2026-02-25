import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiscordBotForm } from './DiscordBotForm';

// Mock toast
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

// Shared mutable mock state
const mockDiscordBotStatus = {
    data: null as null | {
        configured: boolean;
        connected: boolean;
        enabled?: boolean;
        connecting?: boolean;
        guildName?: string;
        memberCount?: number;
        setupCompleted?: boolean;
    },
};

const mockDiscordChannels = {
    data: null as null | { id: string; name: string }[],
};

const mockDiscordDefaultChannel = {
    data: null as null | { channelId: string | null },
};

const mockUpdateDiscordBot = { mutateAsync: vi.fn(), isPending: false };
const mockTestDiscordBot = { mutateAsync: vi.fn(), isPending: false };
const mockClearDiscordBot = { mutateAsync: vi.fn(), isPending: false };
const mockCheckDiscordBotPermissions = { mutateAsync: vi.fn(), isPending: false };
const mockSetDiscordChannel = { mutateAsync: vi.fn(), isPending: false };
const mockResendSetupWizard = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../hooks/use-admin-settings', () => ({
    useAdminSettings: () => ({
        discordBotStatus: mockDiscordBotStatus,
        updateDiscordBot: mockUpdateDiscordBot,
        testDiscordBot: mockTestDiscordBot,
        clearDiscordBot: mockClearDiscordBot,
        checkDiscordBotPermissions: mockCheckDiscordBotPermissions,
        discordChannels: mockDiscordChannels,
        discordDefaultChannel: mockDiscordDefaultChannel,
        setDiscordChannel: mockSetDiscordChannel,
        resendSetupWizard: mockResendSetupWizard,
        // Other fields used by sibling components — provide safe defaults
        oauthStatus: { data: null },
        updateOAuth: { mutateAsync: vi.fn(), isPending: false },
        testOAuth: { mutateAsync: vi.fn(), isPending: false },
        clearOAuth: { mutateAsync: vi.fn(), isPending: false },
        igdbStatus: { data: null },
        updateIgdb: { mutateAsync: vi.fn(), isPending: false },
        testIgdb: { mutateAsync: vi.fn(), isPending: false },
        clearIgdb: { mutateAsync: vi.fn(), isPending: false },
        igdbSyncStatus: { data: null },
        syncIgdb: { mutateAsync: vi.fn(), isPending: false },
        igdbAdultFilter: { data: null },
        updateAdultFilter: { mutateAsync: vi.fn(), isPending: false },
        blizzardStatus: { data: null },
        updateBlizzard: { mutateAsync: vi.fn(), isPending: false },
        testBlizzard: { mutateAsync: vi.fn(), isPending: false },
        clearBlizzard: { mutateAsync: vi.fn(), isPending: false },
        demoDataStatus: { data: null },
        installDemoData: { mutateAsync: vi.fn(), isPending: false },
        clearDemoData: { mutateAsync: vi.fn(), isPending: false },
    }),
}));

describe('DiscordBotForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDiscordBotStatus.data = null;
        mockDiscordChannels.data = null;
        mockDiscordDefaultChannel.data = null;
        mockUpdateDiscordBot.isPending = false;
        mockUpdateDiscordBot.mutateAsync = vi.fn();
        mockTestDiscordBot.isPending = false;
        mockTestDiscordBot.mutateAsync = vi.fn();
        mockClearDiscordBot.isPending = false;
        mockClearDiscordBot.mutateAsync = vi.fn();
        mockCheckDiscordBotPermissions.isPending = false;
        mockCheckDiscordBotPermissions.mutateAsync = vi.fn();
        mockSetDiscordChannel.isPending = false;
        mockSetDiscordChannel.mutateAsync = vi.fn();
        mockResendSetupWizard.isPending = false;
        mockResendSetupWizard.mutateAsync = vi.fn();
    });

    // ── Basic rendering ───────────────────────────────────────────────────

    it('renders bot token input', () => {
        render(<DiscordBotForm />);
        expect(screen.getByLabelText('Bot Token')).toBeInTheDocument();
    });

    it('renders Save Configuration button', () => {
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Save Configuration' })).toBeInTheDocument();
    });

    it('renders Enable Bot toggle', () => {
        render(<DiscordBotForm />);
        expect(screen.getByRole('switch', { name: 'Enable Bot' })).toBeInTheDocument();
    });

    it('renders setup instructions section', () => {
        render(<DiscordBotForm />);
        expect(screen.getByText(/Setup Instructions/)).toBeInTheDocument();
    });

    it('bot token input is type=password by default', () => {
        render(<DiscordBotForm />);
        expect(screen.getByLabelText('Bot Token')).toHaveAttribute('type', 'password');
    });

    it('toggles bot token visibility when eye icon button is clicked', () => {
        render(<DiscordBotForm />);
        const tokenInput = screen.getByLabelText('Bot Token') as HTMLInputElement;
        expect(tokenInput.type).toBe('password');

        const showBtn = screen.getByRole('button', { name: /Show token/ });
        fireEvent.click(showBtn);

        expect(tokenInput.type).toBe('text');
    });

    it('button label changes to "Hide token" after toggle', () => {
        render(<DiscordBotForm />);
        const showBtn = screen.getByRole('button', { name: /Show token/ });
        fireEvent.click(showBtn);
        expect(screen.getByRole('button', { name: /Hide token/ })).toBeInTheDocument();
    });

    // ── Save Configuration button state ───────────────────────────────────

    it('shows "Saving..." when updateDiscordBot is pending', () => {
        mockUpdateDiscordBot.isPending = true;
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    });

    it('does not submit form when bot token is empty', async () => {
        render(<DiscordBotForm />);
        const form = screen.getByLabelText('Bot Token').closest('form')!;
        fireEvent.submit(form);
        expect(mockUpdateDiscordBot.mutateAsync).not.toHaveBeenCalled();
    });

    it('calls updateDiscordBot.mutateAsync with token and enabled when form submitted', async () => {
        mockUpdateDiscordBot.mutateAsync.mockResolvedValueOnce({ success: true, message: 'Saved.' });
        render(<DiscordBotForm />);

        const tokenInput = screen.getByLabelText('Bot Token');
        fireEvent.change(tokenInput, { target: { value: 'my-bot-token' } });

        const form = tokenInput.closest('form')!;
        fireEvent.submit(form);

        await waitFor(() => {
            expect(mockUpdateDiscordBot.mutateAsync).toHaveBeenCalledWith(
                expect.objectContaining({ botToken: 'my-bot-token' }),
            );
        });
    });

    // ── Test Connection button ─────────────────────────────────────────────

    it('does not show Test Connection button when not configured and no token typed', () => {
        mockDiscordBotStatus.data = { configured: false, connected: false };
        render(<DiscordBotForm />);
        expect(screen.queryByRole('button', { name: 'Test Connection' })).not.toBeInTheDocument();
    });

    it('shows Test Connection button when configured', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument();
    });

    it('shows Test Connection button when user has typed a token', () => {
        mockDiscordBotStatus.data = { configured: false, connected: false };
        render(<DiscordBotForm />);

        const tokenInput = screen.getByLabelText('Bot Token');
        fireEvent.change(tokenInput, { target: { value: 'token-123' } });

        expect(screen.getByRole('button', { name: 'Test Connection' })).toBeInTheDocument();
    });

    it('shows "Testing..." when testDiscordBot is pending', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        mockTestDiscordBot.isPending = true;
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Testing...' })).toBeDisabled();
    });

    it('calls testDiscordBot.mutateAsync when Test Connection clicked', async () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        mockTestDiscordBot.mutateAsync.mockResolvedValueOnce({
            success: true,
            message: 'Connected to Test Guild (5 members)',
        });

        render(<DiscordBotForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

        await waitFor(() => {
            expect(mockTestDiscordBot.mutateAsync).toHaveBeenCalled();
        });
    });

    // ── Clear button ──────────────────────────────────────────────────────

    it('does not show Clear button when not configured', () => {
        mockDiscordBotStatus.data = { configured: false, connected: false };
        render(<DiscordBotForm />);
        expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    });

    it('shows Clear button when configured', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    });

    it('does not call clearDiscordBot when confirm dialog is cancelled', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<DiscordBotForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
        expect(mockClearDiscordBot.mutateAsync).not.toHaveBeenCalled();
    });

    it('calls clearDiscordBot when confirm dialog is accepted', async () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        mockClearDiscordBot.mutateAsync.mockResolvedValueOnce({
            success: true,
            message: 'Cleared.',
        });

        render(<DiscordBotForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

        await waitFor(() => {
            expect(mockClearDiscordBot.mutateAsync).toHaveBeenCalled();
        });
    });

    // ── Enable Bot toggle ─────────────────────────────────────────────────

    it('toggle defaults to enabled=true when status has no enabled field', () => {
        mockDiscordBotStatus.data = { configured: false, connected: false };
        render(<DiscordBotForm />);
        const toggle = screen.getByRole('switch', { name: 'Enable Bot' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');
    });

    it('toggle reflects enabled=false from status data', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false, enabled: false };
        render(<DiscordBotForm />);
        const toggle = screen.getByRole('switch', { name: 'Enable Bot' });
        expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    it('clicking toggle flips aria-checked value', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false, enabled: true };
        render(<DiscordBotForm />);
        const toggle = screen.getByRole('switch', { name: 'Enable Bot' });
        expect(toggle).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-checked', 'false');
    });

    // ── Bot status indicator ──────────────────────────────────────────────

    it('does not show bot status section when not configured', () => {
        mockDiscordBotStatus.data = { configured: false, connected: false };
        render(<DiscordBotForm />);
        expect(screen.queryByText('Online')).not.toBeInTheDocument();
        expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    });

    it('shows "Online" status when bot is connected', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            guildName: 'Test Guild',
            memberCount: 100,
        };
        render(<DiscordBotForm />);
        expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('shows "Offline" status when bot is configured but not connected', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        render(<DiscordBotForm />);
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('shows "Starting..." status when bot is connecting', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false, connecting: true };
        render(<DiscordBotForm />);
        expect(screen.getByText('Starting...')).toBeInTheDocument();
    });

    it('shows guild name and member count when connected', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            guildName: 'My Raid Guild',
            memberCount: 50,
        };
        render(<DiscordBotForm />);
        expect(screen.getByText('My Raid Guild')).toBeInTheDocument();
        expect(screen.getByText(/50 members/)).toBeInTheDocument();
    });

    it('shows Test Permissions button when connected', () => {
        mockDiscordBotStatus.data = { configured: true, connected: true };
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Test Permissions' })).toBeInTheDocument();
    });

    it('does not show Test Permissions button when offline', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        render(<DiscordBotForm />);
        expect(screen.queryByRole('button', { name: 'Test Permissions' })).not.toBeInTheDocument();
    });

    // ── Setup Wizard Reminder Banner (ROK-349) ─────────────────────────────

    it('does not show setup reminder banner when setupCompleted is true', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: true,
        };
        render(<DiscordBotForm />);
        expect(screen.queryByText('Complete Discord Setup')).not.toBeInTheDocument();
    });

    it('does not show setup reminder banner when bot is not connected', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: false,
            setupCompleted: false,
        };
        render(<DiscordBotForm />);
        expect(screen.queryByText('Complete Discord Setup')).not.toBeInTheDocument();
    });

    it('does not show setup reminder banner when not configured', () => {
        mockDiscordBotStatus.data = {
            configured: false,
            connected: false,
            setupCompleted: false,
        };
        render(<DiscordBotForm />);
        expect(screen.queryByText('Complete Discord Setup')).not.toBeInTheDocument();
    });

    it('shows setup reminder banner when configured, connected, and setupCompleted=false', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: false,
        };
        render(<DiscordBotForm />);
        expect(screen.getByText('Complete Discord Setup')).toBeInTheDocument();
    });

    it('shows description text in reminder banner', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: false,
        };
        render(<DiscordBotForm />);
        expect(screen.getByText(/setup wizard has not been completed/i)).toBeInTheDocument();
    });

    it('shows "Complete Setup" button in reminder banner', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: false,
        };
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Complete Setup' })).toBeInTheDocument();
    });

    it('"Complete Setup" button calls resendSetupWizard.mutateAsync', async () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: false,
        };
        mockResendSetupWizard.mutateAsync.mockResolvedValueOnce({
            success: true,
            message: 'Wizard sent.',
        });

        render(<DiscordBotForm />);
        fireEvent.click(screen.getByRole('button', { name: 'Complete Setup' }));

        await waitFor(() => {
            expect(mockResendSetupWizard.mutateAsync).toHaveBeenCalledTimes(1);
        });
    });

    it('"Complete Setup" button is disabled when resendSetupWizard is pending', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: false,
        };
        mockResendSetupWizard.isPending = true;
        render(<DiscordBotForm />);
        expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    });

    it('shows "Sending..." label while resendSetupWizard is pending', () => {
        mockDiscordBotStatus.data = {
            configured: true,
            connected: true,
            setupCompleted: false,
        };
        mockResendSetupWizard.isPending = true;
        render(<DiscordBotForm />);
        expect(screen.getByText('Sending...')).toBeInTheDocument();
    });

    // ── Channel selector ──────────────────────────────────────────────────

    it('does not show channel selector when not connected', () => {
        mockDiscordBotStatus.data = { configured: true, connected: false };
        mockDiscordChannels.data = [{ id: '111', name: 'general' }];
        render(<DiscordBotForm />);
        expect(screen.queryByLabelText('Default Notification Channel')).not.toBeInTheDocument();
    });

    it('does not show channel selector when channels list is empty', () => {
        mockDiscordBotStatus.data = { configured: true, connected: true };
        mockDiscordChannels.data = [];
        render(<DiscordBotForm />);
        expect(screen.queryByLabelText('Default Notification Channel')).not.toBeInTheDocument();
    });

    // Channel selector tests moved to discord-panel (ROK-359: channel selector relocated to Channel Bindings tab)
});
