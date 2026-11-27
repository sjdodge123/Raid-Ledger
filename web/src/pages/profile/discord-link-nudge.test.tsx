/** ROK-2371: a Google-created account (no Discord) sees the "Link Discord" nudge. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { ProfileDiscordPanel } from './discord-panel';

let signinMethods: SigninMethodsDto | undefined;
vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: { id: 7, username: 'Ana', discordId: '', avatar: null, signinMethods } }),
}));
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus: () => ({ data: { discordConfigured: true } }) }));
vi.mock('../../hooks/use-discord-link', () => ({ useDiscordLinkAction: () => ({ linkDiscord: vi.fn(), isPending: false }) }));

const NUDGE = /Link Discord to get event reminders by DM, join game hubs and sign up from Discord/;
const renderPanel = () => render(<MemoryRouter><ProfileDiscordPanel /></MemoryRouter>);

describe('ProfileDiscordPanel — Link Discord nudge', () => {
    it('shows for a Google-created account with no Discord', () => {
        signinMethods = { discord: false, google: { email: 'ana@example.com', linkedAt: '2026-11-20T10:00:00.000Z' }, password: false };
        renderPanel();
        expect(screen.getByText(NUDGE)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Link Discord Account/ })).toBeInTheDocument();
    });

    it('is absent for an account without Google (no signinMethods, or Google not linked)', () => {
        signinMethods = { discord: false, google: null, password: true };
        renderPanel();
        expect(screen.queryByText(NUDGE)).toBeNull();
    });
});
