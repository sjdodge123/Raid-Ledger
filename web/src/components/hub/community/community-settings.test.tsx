/**
 * ROK-1870 §3.1 — the community hub's settings-sheet sections: the blurb
 * editor, the Banned list (Unban) for editors, Archive for the Leader and
 * Restore for staff only.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { communityHubBodies, communityHubCalls, communityHubHandlers } from '../../../test/mocks/community-hub-handlers';
import { buildCommunityPage } from '../../../test/factories/community-hub';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubCtx } from '../../../plugins/hub-module';
import { communityHubModule } from './community-hub-module';
import { CommunitySettingsSections } from './community-settings';
import { HubSettingsSheet } from '../settings/settings-sheet';
import { canOpenHubSettings } from '../settings/settings-access';
import { http, HttpResponse } from 'msw';

let userRole = 'member';
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: userRole }, isAuthenticated: true }),
}));

function WithCtx({ page, children }: { page: GuildPage; children: (ctx: HubCtx) => ReactNode }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <>{children({ page, raids })}</>;
}

function renderSections(page: GuildPage): void {
    renderWithProviders(<WithCtx page={page}>{(ctx) => <CommunitySettingsSections {...ctx} />}</WithCtx>);
}

beforeEach(() => {
    userRole = 'member';
    communityHubCalls.length = 0;
    communityHubBodies.length = 0;
    server.use(...communityHubHandlers);
});

describe('community settings sections', () => {
    it('is the module’s settings hook', () => {
        expect(communityHubModule.settingsSections).toBe(CommunitySettingsSections);
    });

    it('saves an edited blurb through PATCH /hubs/:id', async () => {
        renderSections(buildCommunityPage({ role: 'officer' }));
        const box = screen.getByRole('textbox', { name: 'Short description' });
        expect(box).toHaveValue('Honour mode runs');
        const saveBtn = screen.getByRole('button', { name: 'Save description' });
        expect(saveBtn).toBeDisabled();
        await userEvent.clear(box);
        await userEvent.type(box, 'Tactician runs on Fridays');
        await userEvent.click(saveBtn);
        await waitFor(() => expect(communityHubBodies).toEqual([{ blurb: 'Tactician runs on Fridays' }]));
        expect(communityHubCalls).toContain('PATCH /hubs/41');
    });

    it('lists banned users and unbans one', async () => {
        renderSections(buildCommunityPage({ role: 'officer' }));
        expect(await screen.findByText('Griefer')).toBeInTheDocument();
        expect(screen.getByText(/Spam/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Unban Griefer' }));
        await waitFor(() => expect(communityHubCalls).toContain('DELETE /hubs/41/bans/5'));
    });

    it('lets the leader archive an active hub after a confirm', async () => {
        renderSections(buildCommunityPage({ role: 'leader' }));
        await userEvent.click(screen.getByRole('button', { name: 'Archive hub' }));
        expect(communityHubCalls).not.toContain('PATCH /hubs/41/status');
        await userEvent.click(screen.getByTestId('community-archive-confirm'));
        await waitFor(() => expect(communityHubBodies).toEqual([{ status: 'archived' }]));
    });

    it('offers an officer neither Archive nor Restore', async () => {
        renderSections(buildCommunityPage({ role: 'officer' }));
        await screen.findByText('Griefer');
        expect(screen.queryByRole('button', { name: 'Archive hub' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Restore hub' })).not.toBeInTheDocument();
    });

    it('lets staff restore an archived hub', async () => {
        userRole = 'admin';
        renderSections(buildCommunityPage({ role: 'leader', community: { status: 'archived' } }));
        expect(screen.queryByRole('button', { name: 'Archive hub' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Restore hub' }));
        await waitFor(() => expect(communityHubBodies).toEqual([{ status: 'active' }]));
    });

    it('does not offer Restore to a non-staff leader', () => {
        renderSections(buildCommunityPage({ role: 'leader', community: { status: 'archived' } }));
        expect(screen.queryByRole('button', { name: 'Restore hub' })).not.toBeInTheDocument();
    });

});

describe('community settings in the sheet', () => {
    it('opens the settings entry to a community officer, not a member; other kinds keep canManageEditors', () => {
        expect(canOpenHubSettings(buildCommunityPage({ role: 'officer' }))).toBe(true);
        expect(canOpenHubSettings(buildCommunityPage({ role: 'leader' }))).toBe(true);
        expect(canOpenHubSettings(buildCommunityPage({ role: 'member' }))).toBe(false);
        const wow: GuildPage = { ...buildCommunityPage({ role: 'officer' }) };
        delete wow.community;
        expect(canOpenHubSettings({ ...wow, guild: { ...wow.guild, kind: 'wow_guild' } })).toBe(false);
    });

    it('gives an officer the community sections only, not the Leader rows', async () => {
        renderWithProviders(<WithCtx page={buildCommunityPage({ role: 'officer' })}>{(ctx) => (
            <HubSettingsSheet ctx={ctx} module={communityHubModule} onClose={() => undefined} onChangeChannel={() => undefined} />
        )}</WithCtx>);
        expect(await screen.findByTestId('community-settings-banned')).toBeInTheDocument();
        expect(screen.queryByTestId('guild-settings-discord')).not.toBeInTheDocument();
        expect(screen.queryByTestId('guild-settings-editors')).not.toBeInTheDocument();
    });

    it('renders inside the hub settings sheet', async () => {
        server.use(
            http.get('http://localhost:3000/guilds/41/discord', () => HttpResponse.json({ state: 'unset' })),
            http.get('http://localhost:3000/guilds/41/editors', () => HttpResponse.json({ editors: [] })),
        );
        renderWithProviders(<WithCtx page={buildCommunityPage({ role: 'leader' })}>{(ctx) => (
            <HubSettingsSheet ctx={ctx} module={communityHubModule} onClose={() => undefined} onChangeChannel={() => undefined} />
        )}</WithCtx>);
        expect(await screen.findByTestId('community-settings-banned')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Archive hub' })).toBeInTheDocument();
    });

    it('Codex P2: a community leader gets the same Discord channel controls as a server-hub leader', async () => {
        server.use(http.get('http://localhost:3000/guilds/41/discord', () => HttpResponse.json({ state: 'unset' })));
        const onChangeChannel = vi.fn();
        renderWithProviders(<WithCtx page={buildCommunityPage({ role: 'leader' })}>{(ctx) => (
            <HubSettingsSheet ctx={ctx} module={communityHubModule} onClose={() => undefined} onChangeChannel={onChangeChannel} />
        )}</WithCtx>);
        await userEvent.click(await screen.findByTestId('guild-settings-choose-channel'));
        expect(onChangeChannel).toHaveBeenCalledTimes(1);
    });

    it('gives a community leader Discord but no Page editors or Visibility hide (Archive replaces hiding)', async () => {
        server.use(
            http.get('http://localhost:3000/guilds/41/discord', () => HttpResponse.json({ state: 'unset' })),
            http.get('http://localhost:3000/guilds/41/editors', () => HttpResponse.json({ editors: [] })),
        );
        renderWithProviders(<WithCtx page={buildCommunityPage({ role: 'leader' })}>{(ctx) => (
            <HubSettingsSheet ctx={ctx} module={communityHubModule} onClose={() => undefined} onChangeChannel={() => undefined} />
        )}</WithCtx>);
        expect(await screen.findByTestId('community-settings-banned')).toBeInTheDocument();
        expect(screen.getByTestId('guild-settings-discord')).toBeInTheDocument();
        expect(screen.queryByTestId('guild-settings-editors')).not.toBeInTheDocument();
        expect(screen.queryByTestId('guild-settings-visibility')).not.toBeInTheDocument();
    });
});
