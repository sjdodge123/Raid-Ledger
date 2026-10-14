/**
 * ROK-1785: the user menu hosts the generic `user-menu:items` slot at the top
 * of its items and hands the menu's close callback to the filler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { registerPlugin } from '../../plugins/plugin-registry';
import { usePluginStore } from '../../stores/plugin-store';
import { UserMenu } from './UserMenu';

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({
        user: { id: 42, username: 'TestUser', role: 'member', discordId: null, avatar: null, customAvatarUrl: null },
        isAuthenticated: true, isImpersonating: false,
        logout: vi.fn(), impersonate: vi.fn(), exitImpersonation: vi.fn(),
    }),
    isAdmin: () => false,
    isOperatorOrAdmin: () => false,
    getAuthToken: () => 'test-token',
}));
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus: () => ({ data: { discordConfigured: true } }) }));
vi.mock('../../lib/avatar', () => ({ resolveAvatar: () => ({ url: null }), toAvatarUser: (u: unknown) => u }));
vi.mock('../../hooks/use-focus-trap', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../hooks/use-focus-trap')>()),
    useFocusTrap: () => ({ current: null }),
}));

const SLUG = 'test-user-menu-slot';

function FillerItem({ onClose }: { onClose?: () => void }) {
    return <button type="button" data-testid="filler-item" onClick={onClose}>Filler</button>;
}

registerPlugin(SLUG, { icon: 'x', color: 'blue', label: 'Test' }).registerSlot('user-menu:items', FillerItem);

function renderMenu() {
    return render(
        <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter><UserMenu /></MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('UserMenu — user-menu:items slot (ROK-1785)', () => {
    beforeEach(() => { usePluginStore.setState({ activeSlugs: new Set([SLUG]) }); });

    it('renders the slot above My Settings and passes onClose', async () => {
        const user = userEvent.setup();
        renderMenu();
        await user.click(screen.getByTestId('user-menu-trigger'));
        const item = screen.getByTestId('filler-item');
        const settings = screen.getByText('My Settings');
        expect(item.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING, 'the slot sits above My Settings').toBeTruthy();
        await user.click(item);
        expect(screen.queryByText('My Settings'), 'the filler closes the menu through the host onClose').not.toBeInTheDocument();
    });

    it('an inactive plugin renders nothing in the menu', async () => {
        usePluginStore.setState({ activeSlugs: new Set() });
        const user = userEvent.setup();
        renderMenu();
        await user.click(screen.getByTestId('user-menu-trigger'));
        expect(screen.getByText('My Settings')).toBeInTheDocument();
        expect(screen.queryByTestId('filler-item')).not.toBeInTheDocument();
    });
});
