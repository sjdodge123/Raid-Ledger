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
    bg3HubSettingsHandler, bg3MySavesHandler, bg3SessionsHandler, bg3UpdateCampaignHandler, BG3_SETTINGS_URL,
} from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID, BG3_HUB_ID, BG3_SAVE_KEY, buildBg3CampaignSummary, buildBg3CampaignsResponse, buildBg3MySave,
    buildBg3MySavesResponse, buildBg3Session, buildBg3SessionsResponse,
} from '../../../test/factories/bg3';
import { toast } from '../../../lib/toast';
import type { HubCtx } from '../../hub-module';
import { Bg3CampaignTab } from './bg3-campaign-tab';
import { BG3_CAMPAIGN_ARCHIVED_TOAST } from './bg3-campaign-toast';
import { BG3_OTHER_HUB_CAMPAIGN_LABEL } from './bg3-campaign-picker';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 33, username: 'thistle', role: 'member' } }),
}));
vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const MOVE_NOTE = 'Saves from this playthrough already in another campaign move here too.';
let campaigns: Bg3HubCampaignsResponse;
const calls: string[] = [];
const bodies: Record<string, unknown[]> = {};
const spyAs = (tag: string) => (body: unknown, params: Record<string, unknown>) => {
    calls.push(tag);
    (bodies[tag] ??= []).push(tag === 'key' ? params['campaignKey'] : body);
};

function renderTab(joined?: boolean) {
    // Staff resolve as ladder `leader` everywhere; `community.viewerJoined` says whether they joined.
    const viewer = { role: joined === false ? 'leader' : 'member', canEdit: joined === false, canManageEditors: false };
    const community = joined === undefined ? {} : { community: { viewerJoined: joined } };
    const page = { guild: { id: BG3_HUB_ID }, viewer, ...community } as GuildPage;
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
        await user.click(within(sheet).getByRole('checkbox', { name: 'Also put my other unfiled saves and future saves here' }));
        await user.click(screen.getByRole('button', { name: 'Add 2 playthroughs · 2 saves' }));
        await waitFor(() => expect(calls).toEqual(['key', 'key', 'default']));
        expect(bodies['key']).toEqual([BG3_SAVE_KEY, 'b'.repeat(64)]);
        expect(bodies['default']).toEqual([{ campaignId: BG3_CAMPAIGN_ID }]);
    });

    it('groups saves by playthrough: one tick selects every save in it, and says filed saves move too', async () => {
        server.use(bg3MySavesHandler(buildBg3MySavesResponse({
            saves: [
                buildBg3MySave({ id: 401, saveName: 'QuickSave_2', savedAt: '2026-10-26T20:00:00.000Z' }),
                buildBg3MySave({ id: 404, saveName: 'QuickSave_1', savedAt: '2026-10-25T20:00:00.000Z' }),
                buildBg3MySave({ id: 405, saveName: 'AutoSave_3', savedAt: '2026-10-24T20:00:00.000Z' }),
                buildBg3MySave({ id: 402, saveName: 'AutoSave_9', campaignKey: 'b'.repeat(64) }),
            ],
        })));
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('button', { name: 'Add my saves' }));
        const sheet = await screen.findByTestId('bg3-add-saves');
        const list = await within(sheet).findByRole('list', { name: 'Your playthroughs that aren’t in a campaign' });
        expect(within(list).getAllByRole('checkbox')).toHaveLength(2);
        expect(within(list).queryByRole('checkbox', { name: /QuickSave_1/ })).not.toBeInTheDocument();
        expect(within(sheet).getByText(/^3 saves · /)).toBeInTheDocument();
        expect(within(sheet).queryByText(MOVE_NOTE)).not.toBeInTheDocument();
        await user.click(within(list).getByRole('checkbox', { name: /QuickSave_2/ }));
        expect(within(sheet).getByText(MOVE_NOTE)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Add 1 playthrough · 3 saves' }));
        await waitFor(() => expect(calls).toEqual(['key']));
        expect(bodies['key']).toEqual([BG3_SAVE_KEY]);
    });
});

describe('New saves go to (default in another hub)', () => {
    it('shows a default from another hub as set, and "No campaign" clears it', async () => {
        server.use(bg3MySavesHandler(buildBg3MySavesResponse({ defaultCampaignId: 999 })));
        const user = userEvent.setup();
        renderTab();
        const select = await screen.findByLabelText(/New saves go to/);
        await waitFor(() => expect(select).toBeEnabled());
        expect(select).toHaveDisplayValue(BG3_OTHER_HUB_CAMPAIGN_LABEL);
        await user.selectOptions(select, 'No campaign');
        await waitFor(() => expect(bodies['default']).toEqual([{ campaignId: null }]));
    });
});

describe('Q9 staff are view-only', () => {
    it('hides Start a campaign, Add my saves and New saves go to from non-member staff', async () => {
        campaigns = buildBg3CampaignsResponse({ canEdit: true });
        renderTab(false);
        expect(within(await screen.findByRole('list', { name: 'Campaigns' })).getByText('Tactician run')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Start a campaign' })).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Your saves' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add my saves' })).not.toBeInTheDocument();
        expect(screen.queryByText(/New saves go to/)).not.toBeInTheDocument();
        expect(screen.getByTestId('bg3-editor-section')).toBeInTheDocument();
    });

    it('keeps them for a member who joined the hub', async () => {
        renderTab(true);
        expect(await screen.findByRole('button', { name: 'Start a campaign' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add my saves' })).toBeInTheDocument();
        expect(screen.getByText(/New saves go to/)).toBeInTheDocument();
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

describe('Campaigns section — every campaign archived', () => {
    it('says there is no active campaign, not "none yet", above "Archived (1)"', async () => {
        campaigns = buildBg3CampaignsResponse({
            canEdit: true,
            settings: { hideLocationAndScreenshots: false, activeCampaignId: null },
            campaigns: [buildBg3CampaignSummary({ archivedAt: '2026-10-28T10:00:00.000Z' })],
        });
        renderTab();
        expect(await screen.findByText('No active campaign.')).toBeInTheDocument();
        expect(screen.getByText('Archived (1)')).toBeInTheDocument();
        expect(screen.queryByText('No campaign on this hub yet.')).toBeNull();
    });
});

describe('History section (D-9)', () => {
    it('lists the active campaign\'s sessions and pages with "Show more" via nextCursor', async () => {
        const cursors: (string | null)[] = [];
        server.use(bg3SessionsHandler({
            '': buildBg3SessionsResponse({ nextCursor: 'page-2' }),
            'page-2': buildBg3SessionsResponse({
                sessions: [buildBg3Session({ startedAt: '2026-10-20T19:00:00.000Z', endedAt: '2026-10-20T21:00:00.000Z', lastSaveId: 200 })],
                nextCursor: null,
            }),
        }, (url) => cursors.push(url.searchParams.get('cursor'))));
        const user = userEvent.setup();
        renderTab();
        const history = await screen.findByTestId('bg3-history');
        await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(2));
        await user.click(screen.getByRole('button', { name: 'Show more' }));
        await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(3));
        expect(cursors).toEqual([null, 'page-2']);
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('has no History section without an active campaign', async () => {
        campaigns = buildBg3CampaignsResponse({ settings: { hideLocationAndScreenshots: false, activeCampaignId: null } });
        renderTab();
        expect(await screen.findByTestId('bg3-campaign-tab')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'History' })).not.toBeInTheDocument();
    });
});
