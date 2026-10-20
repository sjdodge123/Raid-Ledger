/**
 * ROK-1870 §3.7 W7–W9, W11 — the core community hub module: Join gating,
 * the officer/leader row menu, the leader's transfer prompt, and the module
 * resolving with every plugin off.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within, renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { communityHubCalls, communityHubHandlers } from '../../../test/mocks/community-hub-handlers';
import { buildCommunityPage } from '../../../test/factories/community-hub';
import { renderWithProviders } from '../../../test/render-helpers';
import { usePluginStore } from '../../../stores/plugin-store';
import { useHubModule, type HubCtx } from '../../../plugins/hub-module';
import { HubMembers } from '../hub-members';
import { communityHubModule } from './community-hub-module';
import { CommunityJoinPill, CommunityKindPill } from './community-hero';

let selfId = 3;
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: selfId, role: 'member' }, isAuthenticated: true }),
}));

function WithCtx({ page, children }: { page: GuildPage; children: (ctx: HubCtx) => ReactNode }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <>{children({ page, raids })}</>;
}

function renderHero(page: GuildPage): void {
    renderWithProviders(<WithCtx page={page}>{(ctx) => <><CommunityKindPill {...ctx} /><CommunityJoinPill {...ctx} /></>}</WithCtx>);
}

function renderMembers(page: GuildPage): void {
    renderWithProviders(<WithCtx page={page}>{(ctx) => <HubMembers ctx={ctx} module={communityHubModule} />}</WithCtx>);
}

function rowOf(name: string): HTMLElement {
    const row = screen.getAllByTestId('guild-member-row').find((r) => r.textContent?.includes(name));
    if (!row) throw new Error(`no member row for ${name}`);
    return row;
}

beforeEach(() => { communityHubCalls.length = 0; server.use(...communityHubHandlers); });

describe('community hub hero', () => {
    it('shows the "Community hub" chip and the leader', () => {
        renderHero(buildCommunityPage());
        expect(screen.getByTestId('community-hub-kind')).toHaveTextContent('Community hub');
        expect(screen.getByTestId('community-hub-leader')).toHaveTextContent('Led by Lead');
    });

    it('marks a proposed hub for staff', () => {
        renderHero(buildCommunityPage({ role: 'leader', community: { status: 'proposed' } }));
        expect(screen.getByTestId('community-hub-kind')).toHaveTextContent('Proposed');
    });

    it('W7: a visitor outside Discord gets a disabled Join and the reason', () => {
        renderHero(buildCommunityPage({ role: 'visitor', community: { canJoin: false, joinBlockedReason: 'not-in-discord' } }));
        expect(screen.getByTestId('community-hub-join')).toBeDisabled();
        expect(screen.getByTestId('community-hub-join-blocked')).toHaveTextContent('Join the Discord server to join hubs');
    });

    it('a visitor who may join POSTs /hubs/:id/join', async () => {
        renderHero(buildCommunityPage({ role: 'visitor', community: { viewerJoined: false } }));
        await userEvent.click(screen.getByTestId('community-hub-join'));
        await waitFor(() => expect(communityHubCalls).toEqual(['POST /hubs/41/join']));
    });

    it('W9: a leader with members gets the transfer prompt, not a DELETE', async () => {
        renderHero(buildCommunityPage({ role: 'leader' }));
        await userEvent.click(screen.getByTestId('community-hub-leave'));
        expect(screen.getByTestId('community-hub-transfer-prompt')).toBeInTheDocument();
        expect(communityHubCalls).toEqual([]);
    });

    it('a member leaves after one confirm', async () => {
        renderHero(buildCommunityPage({ role: 'member' }));
        await userEvent.click(screen.getByTestId('community-hub-leave'));
        await userEvent.click(screen.getByTestId('community-hub-leave-yes'));
        await waitFor(() => expect(communityHubCalls).toEqual(['DELETE /hubs/41/join']));
    });
});

describe('community Members tab', () => {
    it('shows each role as a chip', () => {
        selfId = 3;
        renderMembers(buildCommunityPage());
        expect(screen.getAllByTestId('community-member-role').map((c) => c.textContent)).toEqual(['Leader', 'Officer', 'Member']);
        expect(screen.queryByTestId('community-member-manage'), 'a plain member manages nobody').toBeNull();
    });

    it('W8: an officer has no menu on the leader row; the member row offers Remove and Ban', async () => {
        selfId = 2;
        renderMembers(buildCommunityPage({ role: 'officer' }));
        expect(within(rowOf('Lead')).queryByTestId('community-member-manage')).toBeNull();
        await userEvent.click(within(rowOf('Mem')).getByTestId('community-member-manage'));
        expect(screen.getByTestId('community-member-remove')).toBeInTheDocument();
        expect(screen.getByTestId('community-member-ban')).toBeInTheDocument();
        expect(screen.queryByTestId('community-member-make-officer'), 'promote is leader-only').toBeNull();
        await userEvent.click(screen.getByTestId('community-member-remove'));
        await waitFor(() => expect(communityHubCalls).toEqual(['DELETE /hubs/41/members/3']));
    });

    it('the leader promotes a member and bans with a reason', async () => {
        selfId = 1;
        renderMembers(buildCommunityPage({ role: 'leader' }));
        await userEvent.click(within(rowOf('Mem')).getByTestId('community-member-manage'));
        await userEvent.click(screen.getByTestId('community-member-make-officer'));
        await waitFor(() => expect(communityHubCalls).toEqual(['PATCH /hubs/41/members/3/role']));
        await userEvent.click(within(rowOf('Offy')).getByTestId('community-member-manage'));
        await userEvent.click(screen.getByTestId('community-member-ban'));
        await userEvent.type(screen.getByLabelText('Reason (optional)'), 'spam');
        await userEvent.click(screen.getByTestId('community-ban-confirm'));
        await waitFor(() => expect(communityHubCalls).toContain('PUT /hubs/41/bans/2'));
    });

    it('a visitor sees the Join invite when the list is empty', () => {
        renderMembers(buildCommunityPage({ role: 'visitor', community: { viewerJoined: false }, members: [] }));
        expect(screen.getByTestId('guild-members-empty')).toHaveTextContent("Join to see who's here");
    });
});

describe('W11: useHubModule', () => {
    it('returns the core community module with every plugin off', () => {
        usePluginStore.setState({ activeSlugs: new Set<string>() });
        const { result } = renderHook(() => useHubModule('game_community'));
        expect(result.current).toBe(communityHubModule);
        expect(result.current?.tabs).toEqual([]);
    });
});
