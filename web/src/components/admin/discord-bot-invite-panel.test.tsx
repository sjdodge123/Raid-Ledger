/**
 * ROK-1471 (T21, T22): the invite panel renders the permission list served by
 * the API — no static copy — plus the invite URL, copy button and the
 * install-time re-authorisation explanation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DiscordBotInvitePanel } from './discord-bot-invite-panel';

const mockInvite = {
    data: null as null | { url: string | null; permissions: string[]; clientId: string | null },
};

vi.mock('../../hooks/admin/use-lfg-board-settings', () => ({
    useBotInviteInfo: () => mockInvite,
}));

const toastSuccess = vi.fn();
vi.mock('../../lib/toast', () => ({
    toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

const writeText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

describe('DiscordBotInvitePanel (ROK-1471)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockInvite.data = {
            url: 'https://discord.com/oauth2/authorize?client_id=42&scope=bot',
            permissions: ['Manage Channels', 'Manage Threads', 'Zebra Permission'],
            clientId: '42',
        };
    });

    // T21 — a permission name that appears in NO static copy still renders,
    // which is only possible when the list comes from the API.
    it('renders every permission name returned by the API', () => {
        render(<DiscordBotInvitePanel />);
        const items = screen.getAllByRole('listitem').map((li) => li.textContent);
        expect(items).toContain('Zebra Permission');
        expect(items).toContain('Manage Threads');
        expect(items).toContain('Manage Channels');
    });

    it('renders the invite URL as a new-tab anchor', () => {
        render(<DiscordBotInvitePanel />);
        const link = screen.getByRole('link', { name: /invite url/i });
        expect(link).toHaveAttribute('href', mockInvite.data!.url);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel')).toContain('noreferrer');
    });

    // T22 — the install-time semantics must be explained on the page.
    it('explains that permissions are granted at install time', () => {
        render(<DiscordBotInvitePanel />);
        expect(screen.getByText(/install time/i)).toBeInTheDocument();
        expect(
            screen.getByText(/does not change an existing guild install/i),
        ).toBeInTheDocument();
        expect(screen.getByText(/without removing the bot/i)).toBeInTheDocument();
    });

    it('copies the invite URL to the clipboard and toasts', async () => {
        render(<DiscordBotInvitePanel />);
        fireEvent.click(screen.getByRole('button', { name: /copy invite url/i }));
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith(mockInvite.data!.url);
        });
        expect(toastSuccess).toHaveBeenCalled();
    });

    it('still lists permissions but explains the URL is pending when no client id is saved', () => {
        mockInvite.data = { url: null, permissions: ['Manage Channels'], clientId: null };
        render(<DiscordBotInvitePanel />);
        expect(screen.getByText('Manage Channels')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /invite url/i })).not.toBeInTheDocument();
        expect(screen.getByText(/client id/i)).toBeInTheDocument();
    });
});
