/**
 * ROK-1630 AC16 (ROK-1366 review): every "Link Discord" trigger is disabled
 * while the POST /auth/discord/link/start is pending, so a double click can
 * never mint two nonces or start two redirects.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { User } from './use-auth';

const linkDiscord = vi.fn();

vi.mock('./use-discord-link', () => ({
    useDiscordLinkAction: () => ({ linkDiscord, isPending: true }),
    useDiscordLink: () => linkDiscord,
}));

const unlinkedUser = {
    id: 1, username: 'NoDiscord', discordId: null, avatar: null,
    customAvatarUrl: null, role: 'admin', characters: [],
} as unknown as User;

vi.mock('./use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./use-auth')>()),
    useAuth: () => ({ user: unlinkedUser, isAuthenticated: true, refetch: vi.fn() }),
}));
vi.mock('./use-system-status', () => ({
    useSystemStatus: () => ({ data: { discordConfigured: true, steamConfigured: false } }),
}));
vi.mock('./use-onboarding', () => ({
    useOnboarding: () => ({ changePassword: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('./use-steam-link', () => ({
    useSteamLink: () => ({
        linkSteam: vi.fn(), isLinkPending: false, steamStatus: { data: undefined },
        unlinkSteam: { mutate: vi.fn(), isPending: false },
        syncLibrary: { mutate: vi.fn(), isPending: false },
        syncWishlist: { mutate: vi.fn(), isPending: false },
    }),
}));

import { ProfileDiscordPanel } from '../pages/profile/discord-panel';
import { UserInfoCard } from '../components/profile/UserInfoCard';
import { SecureAccountStep } from '../components/admin/onboarding/secure-account-step';
import { IntegrationsPanel } from '../pages/profile/integrations-panel';
import { LinkDiscordPrompt } from '../pages/admin/discord-connection-page';

const TRIGGERS: [string, () => ReactElement][] = [
    ['profile Discord panel', () => <ProfileDiscordPanel />],
    ['profile user card', () => <UserInfoCard user={unlinkedUser} />],
    ['admin onboarding secure-account step', () => <SecureAccountStep onNext={vi.fn()} onSkip={vi.fn()} />],
    ['profile integrations panel', () => <IntegrationsPanel />],
    ['admin Discord connection prompt', () => <LinkDiscordPrompt icon={null} />],
];

describe('Discord link triggers while start is pending (AC16)', () => {
    it.each(TRIGGERS)('%s: the Link Discord button is disabled', (_where, ui) => {
        render(<MemoryRouter>{ui()}</MemoryRouter>);
        const button = screen.getByRole('button', { name: /link discord/i });
        expect(button, 'a pending link start must disable its trigger').toBeDisabled();
    });
});
