/** ROK-1958 V-8 / V-9 / V-10 — Campaign tab: start dialog, Add my saves, editor section + archive. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Bg3HubCampaignsResponse, GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    BG3_CAMPAIGNS_URL, bg3BindKeyHandler, bg3CreateCampaignHandler, bg3DefaultCampaignHandler, bg3Error,
    bg3HubSettingsHandler, bg3MySavesHandler, bg3UpdateCampaignHandler, BG3_SETTINGS_URL,
} from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID, BG3_HUB_ID, BG3_SAVE_KEY, buildBg3CampaignSummary, buildBg3CampaignsResponse, buildBg3MySave,
    buildBg3MySavesResponse,
} from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import type { HubCtx } from '../../hub-module';
import { Bg3CampaignTab } from './bg3-campaign-tab';
import { BG3_CAMPAIGN_ARCHIVED_TOAST } from './bg3-campaign-toast';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 33, username: 'thistle', role: 'member' } }),
}));
vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

let campaigns: Bg3HubCampaignsResponse;
const calls: string[] = [];
const bodies: Record<string, unknown[]> = {};
const spyAs = (tag: string) => (body: unknown, params: Record<string, unknown>) => {
    calls.push(tag);
    (bodies[tag] ??= []).push(tag === 'key' ? params['campaignKey'] : body);
};

function renderTab() {
    const page = { guild: { id: BG3_HUB_ID }, viewer: { role: 'member', canEdit: false, canManageEditors: false } } as GuildPage;
    return renderWithProviders(<Bg3CampaignTab {...({ page } as HubCtx)} />);
}

beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(bodies)) delete bodies[k];
    vi.mocked(toast.error).mockClear();
    campaigns = buildBg3CampaignsResponse();
    server.use(
        http.get(BG3_CAMPAIGNS_URL, () => HttpResponse.json(campaigns)),
        bg3CreateCampaignHandler(buildBg3CampaignSummary({ id: 12, name: 'The Long Rest' }), spyAs('create')),
        bg3DefaultCampaignHandler(spyAs('default')),
        bg3BindKeyHandler(spyAs('key')),
    );
});

describe('V-8 start dialog', () => {
    it('requires a 1–64 character name, then POSTs the campaign and PUTs it as my default', async () => {
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('button', { name: 'Start a campaign' }));
        await user.click(screen.getByRole('button', { name: 'Start campaign' }));
        expect(await screen.findByText('Give the campaign a name.')).toBeInTheDocument();
        await user.type(screen.getByLabelText(/Campaign name/), 'x'.repeat(65));
        await user.click(screen.getByRole('button', { name: 'Start campaign' }));
        expect(await screen.findByText('Use 64 characters or fewer.')).toBeInTheDocument();
        expect(calls).toEqual([]);
        await user.clear(screen.getByLabelText(/Campaign name/));
        await user.type(screen.getByLabelText(/Campaign name/), '  The Long Rest ');
        expect(screen.getByRole('checkbox', { name: /Put my saves in this campaign/ })).toBeChecked();
        await user.click(screen.getByRole('button', { name: 'Start campaign' }));
        await waitFor(() => expect(calls).toEqual(['create', 'default']));
        expect(bodies['create']).toEqual([{ name: 'The Long Rest' }]);
        expect(bodies['default']).toEqual([{ campaignId: 12 }]);
    });

    it('asks before discarding a typed name on Cancel', async () => {
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('button', { name: 'Start a campaign' }));
        await user.type(screen.getByLabelText(/Campaign name/), 'Honour');
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
        expect(screen.getByLabelText(/Campaign name/)).toHaveValue('Honour');
    });
});

describe('V-9 add my saves', () => {
    it('lists only unassigned saves and binds each selected key, then the default', async () => {
        server.use(bg3MySavesHandler(buildBg3MySavesResponse({
            saves: [...buildBg3MySavesResponse().saves, buildBg3MySave({ id: 403, saveName: 'Filed_1', campaignId: BG3_CAMPAIGN_ID })],
        })));
        const user = userEvent.setup();
        renderTab();
        expect(await screen.findByText('2 of your saves aren’t in a campaign.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Add my saves' }));
        const sheet = await screen.findByTestId('bg3-add-saves');
        expect(within(sheet).queryByText('Filed_1')).not.toBeInTheDocument();
        await user.click(within(sheet).getByRole('checkbox', { name: /QuickSave_2/ }));
        await user.click(within(sheet).getByRole('checkbox', { name: /AutoSave_9/ }));
        await user.click(within(sheet).getByRole('checkbox', { name: /Also put my future saves here/ }));
        await user.click(screen.getByRole('button', { name: 'Add 2 saves' }));
        await waitFor(() => expect(calls).toEqual(['key', 'key', 'default']));
        expect(bodies['key']).toEqual([BG3_SAVE_KEY, 'b'.repeat(64)]);
        expect(bodies['default']).toEqual([{ campaignId: BG3_CAMPAIGN_ID }]);
    });
});

describe('V-10 editor section and archive', () => {
    it('hides Hub settings and Archive from a member who is not the host', async () => {
        campaigns = buildBg3CampaignsResponse({ campaigns: [buildBg3CampaignSummary({ hostUserId: 21 })] });
        renderTab();
        expect(within(await screen.findByRole('list', { name: 'Campaigns' })).getByText('Tactician run')).toBeInTheDocument();
        expect(screen.queryByTestId('bg3-editor-section')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    });

    it('lets an editor flip the spoiler switch', async () => {
        campaigns = buildBg3CampaignsResponse({ canEdit: true });
        server.use(bg3HubSettingsHandler(undefined, spyAs('settings')));
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('switch', { name: 'Hide location and screenshots' }));
        await waitFor(() => expect(bodies['settings']).toEqual([{ hideLocationAndScreenshots: true }]));
    });

    it('toasts clearly when the api says the campaign is archived', async () => {
        campaigns = buildBg3CampaignsResponse({ canEdit: true, settings: { hideLocationAndScreenshots: false, activeCampaignId: null } });
        server.use(http.put(BG3_SETTINGS_URL, () => bg3Error(400, 'campaign_archived')));
        const user = userEvent.setup();
        renderTab();
        await user.selectOptions(await screen.findByLabelText('Active campaign'), String(BG3_CAMPAIGN_ID));
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(BG3_CAMPAIGN_ARCHIVED_TOAST));
    });

    it('archives after the confirm, moves the row under "Archived (1)", and unarchives', async () => {
        campaigns = buildBg3CampaignsResponse({ canEdit: true });
        server.use(bg3UpdateCampaignHandler(undefined, (body, params) => {
            spyAs('patch')(body, params);
            const archived = (body as { archived: boolean }).archived;
            campaigns = buildBg3CampaignsResponse({
                canEdit: true, campaigns: [buildBg3CampaignSummary({ archivedAt: archived ? '2026-10-28T10:00:00.000Z' : null })],
            });
        }));
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('button', { name: 'Archive' }));
        expect(await screen.findByText(/Its history stays/)).toBeInTheDocument();
        expect(calls).toEqual([]);
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
        await user.click(await screen.findByText('Archived (1)'));
        const archivedList = screen.getByRole('list', { name: 'Archived campaigns' });
        expect(within(archivedList).getByText('Tactician run')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Campaigns' })).not.toBeInTheDocument();
        await user.click(within(archivedList).getByRole('button', { name: 'Unarchive' }));
        await waitFor(() => expect(bodies['patch']).toEqual([{ archived: true }, { archived: false }]));
        expect(await screen.findByRole('list', { name: 'Campaigns' })).toBeInTheDocument();
    });
});
