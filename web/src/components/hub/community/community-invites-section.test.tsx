/**
 * ROK-1893 P1 — the "Invite people" action (every live member of an active
 * hub), its dialog (create with the 7-day default, the per-member cap line,
 * Revoke only where the viewer may) and the Leader/Officer settings list.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto, HubInvite } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { buildCommunityPage } from '../../../test/factories/community-hub';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    createMockHubInvite, hubInviteCreateHandler, hubInviteListHandler, hubInviteRevokeHandler,
} from '../../../test/mocks/hub-invite-handlers';
import type { HubCtx } from '../../../plugins/hub-module';
import { CommunityInvitesSettingsSection, HubInviteAction } from './community-invites-section';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 42, role: 'member' }, isAuthenticated: true }),
}));

function WithCtx({ page, children }: { page: GuildPage; children: (ctx: HubCtx) => ReactNode }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <>{children({ page, raids })}</>;
}

function renderAction(page: GuildPage): void {
    renderWithProviders(<WithCtx page={page}>{(ctx) => <HubInviteAction {...ctx} />}</WithCtx>);
}

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const mine = (id: number, extra: Partial<HubInvite> = {}): HubInvite =>
    createMockHubInvite({ id, token: `tok_${id}`, url: `http://localhost:5173/h/tok_${id}`, expiresAt: future, ...extra });

let bodies: unknown[] = [];
let revoked: string[] = [];
beforeEach(() => {
    bodies = [];
    revoked = [];
    server.use(hubInviteCreateHandler(mine(9), bodies), hubInviteRevokeHandler(revoked));
});

describe('HubInviteAction', () => {
    it('is hidden from a visitor (not a live member)', () => {
        server.use(hubInviteListHandler({ items: [], liveByViewer: 0, perMemberCap: 5 }));
        renderAction(buildCommunityPage({ role: 'visitor' }));
        expect(screen.queryByRole('button', { name: 'Invite people' })).toBeNull();
    });

    it('lets a plain member create a link with the 7-day default', async () => {
        server.use(hubInviteListHandler({ items: [], liveByViewer: 0, perMemberCap: 5 }));
        renderAction(buildCommunityPage({ role: 'member' }));
        await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
        expect(await screen.findByTestId('hub-invite-expiry')).toHaveValue('168');
        await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
        await waitFor(() => expect(bodies).toEqual([{ expiresInHours: 168 }]));
    });

    it('sends null for a never-expiring link', async () => {
        server.use(hubInviteListHandler({ items: [], liveByViewer: 0, perMemberCap: 5 }));
        renderAction(buildCommunityPage({ role: 'member' }));
        await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
        await userEvent.selectOptions(await screen.findByTestId('hub-invite-expiry'), 'never');
        await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
        await waitFor(() => expect(bodies).toEqual([{ expiresInHours: null }]));
    });

    it('shows the newest link to copy, the joined count, and Revoke', async () => {
        server.use(hubInviteListHandler({
            items: [mine(1, { createdAt: '2026-10-01T00:00:00.000Z', useCount: 3 }), mine(2, { createdAt: '2026-10-05T00:00:00.000Z' })],
            liveByViewer: 2, perMemberCap: 5,
        }));
        renderAction(buildCommunityPage({ role: 'member' }));
        await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
        expect(await screen.findByTestId('hub-invite-url')).toHaveValue('http://localhost:5173/h/tok_2');
        expect(screen.getByText(/3 joined/)).toBeInTheDocument();
        const [firstRevoke] = screen.getAllByRole('button', { name: 'Revoke' });
        if (!firstRevoke) throw new Error('expected a Revoke button');
        await userEvent.click(firstRevoke);
        await waitFor(() => expect(revoked).toEqual(['1']));
    });

    it('at the cap, replaces Create with "Revoke one to make another"', async () => {
        server.use(hubInviteListHandler({ items: [1, 2, 3, 4, 5].map((i) => mine(i)), liveByViewer: 5, perMemberCap: 5 }));
        renderAction(buildCommunityPage({ role: 'member' }));
        await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
        expect(await screen.findByTestId('hub-invite-cap')).toHaveTextContent('Revoke one to make another');
        expect(screen.queryByRole('button', { name: 'Create link' })).toBeNull();
    });
});

describe('CommunityInvitesSettingsSection', () => {
    it('lists every live link with its maker; Revoke only where canRevoke', async () => {
        server.use(hubInviteListHandler({
            items: [
                mine(1, { createdBy: { id: 5, displayName: 'Thora' }, canRevoke: true }),
                mine(2, { createdBy: { id: 6, displayName: 'Bjorn' }, canRevoke: false }),
                mine(3, { revokedAt: '2026-10-02T00:00:00.000Z' }),
            ],
            liveByViewer: 0, perMemberCap: 5,
        }));
        renderWithProviders(<CommunityInvitesSettingsSection hubId={7} />);
        expect(await screen.findAllByTestId('hub-invite-row')).toHaveLength(2);
        expect(screen.getByText(/Thora/)).toBeInTheDocument();
        expect(screen.getByText(/Bjorn/)).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
    });
});
