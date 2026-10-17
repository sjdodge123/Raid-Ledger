/**
 * ROK-1830 S4 — the Guild settings sheet itself: the Discord row reads the
 * bound channel, the editors section removes a grant through the existing
 * DELETE endpoint, a hub whose module offers no delegation says so instead of
 * showing half a form, and the hub-visibility switch stays disabled while no
 * endpoint backs it (spec Q7 → ROK-1831).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildDiscordMirrorDto, GuildEditor, GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { okMirror, discordMessage } from '../../../test/mocks/guild-discord-handlers';
import type { HubCtx, HubModule } from '../../../plugins/hub-module';
import { HubSettingsSheet } from './settings-sheet';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7';

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 1, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'leader', canEdit: true, canManageEditors: true },
    ranks: [{ rankIndex: 0, rankName: 'Guild Master', members: [] }],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

const RANK_EDITOR: GuildEditor = {
    id: 11, guildId: 7, kind: 'rank', rankIndex: 2, rankName: 'Raider', guildMemberId: null, memberName: null,
    grantedBy: 'Grimtusk', createdAt: '2026-10-14T10:00:00.000Z',
};

let deletes: number[] = [];

function serve(mirror: GuildDiscordMirrorDto, editors: GuildEditor[] = [RANK_EDITOR]): void {
    server.use(
        http.get(`${BASE}/discord`, () => HttpResponse.json(mirror)),
        http.get(`${BASE}/editors`, () => HttpResponse.json({ editors })),
        http.delete(`${BASE}/editors/:editorId`, ({ params }) => {
            deletes.push(Number(params['editorId']));
            return new HttpResponse(null, { status: 204 });
        }),
    );
}

/**
 * The raids query is never read by the sheet, so a pending result is enough —
 * spelled out as a real `UseQueryResult` rather than an `as unknown as` cast,
 * which would hide a future field the sheet starts reading.
 */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used by the settings sheet')),
};

function ctxFor(): HubCtx {
    return { page: PAGE, raids: IDLE_RAIDS };
}

function renderSheet(module?: HubModule): void {
    renderWithProviders(
        <HubSettingsSheet ctx={ctxFor()} module={module} onClose={() => undefined} onChangeChannel={() => undefined} />,
    );
}

beforeEach(() => { deletes = []; });

describe('HubSettingsSheet (ROK-1830 S4)', () => {
    it('names the bound channel and offers to change it', async () => {
        serve(okMirror([discordMessage(1)]));
        renderSheet();
        await waitFor(() => expect(screen.getByTestId('guild-settings-channel')).toHaveTextContent('#announcements'));
        expect(screen.getByTestId('guild-settings-choose-channel')).toHaveTextContent('Change channel');
    });

    it('offers to choose one when nothing is bound', async () => {
        serve({ state: 'unset' });
        renderSheet();
        await waitFor(() => expect(screen.getByTestId('guild-settings-channel')).toHaveTextContent('No channel chosen yet.'));
        expect(screen.getByTestId('guild-settings-choose-channel')).toHaveTextContent('Choose channel');
    });

    it('removes an editor through DELETE /editors/:id', async () => {
        serve({ state: 'unset' });
        renderSheet();
        const panel = await screen.findByTestId('guild-editors-panel');
        const chip = await within(panel).findByTestId('guild-editor-chip');
        expect(chip).toHaveTextContent('Rank: Raider');
        await userEvent.click(within(chip).getByRole('button', { name: 'Remove Rank: Raider' }));
        await waitFor(() => expect(deletes).toEqual([11]));
    });

    it('says so when the hub module contributes no delegation pickers', async () => {
        serve({ state: 'unset' }, []);
        renderSheet();
        const panel = await screen.findByTestId('guild-editors-panel');
        expect(await within(panel).findByTestId('guild-editors-no-delegation')).toHaveTextContent('no delegation options');
        expect(within(panel).queryByTestId('guild-editor-rank-select'), 'core must never invent a rank picker').toBeNull();
    });

    it('keeps "Hide this hub" disabled and off while no endpoint backs it', async () => {
        serve({ state: 'unset' });
        renderSheet();
        const hide = await screen.findByTestId('guild-settings-hide-hub');
        expect(hide).toBeDisabled();
        expect(hide).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByText(/Hiding a hub isn’t available yet/)).toBeInTheDocument();
    });

    it('a failed mirror read says so instead of sitting on "Loading…"', async () => {
        server.use(
            http.get(`${BASE}/discord`, () => new HttpResponse(null, { status: 500 })),
            http.get(`${BASE}/editors`, () => HttpResponse.json({ editors: [] })),
        );
        renderSheet();
        const alert = await screen.findByTestId('guild-settings-channel-error');
        expect(alert, 'a 500 must surface the inline error, not Loading…').toHaveTextContent('Couldn’t load the Discord channel.');
        expect(screen.queryByTestId('guild-settings-channel')).toBeNull();
    });
});
