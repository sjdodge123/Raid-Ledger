/**
 * ROK-1933 part 4 — "Re-post welcome message" in the hub settings sheet's
 * Discord section: Valheim server hubs with a bound channel only, Leader /
 * staff only (the sheet's `canManageEditors` gate = the route's
 * `GuildLeaderGuard`), and the route's answer shown inline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildDiscordMirrorDto, GuildPage as GuildPageDto, HubWelcomeResult } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { okMirror } from '../../../test/mocks/guild-discord-handlers';
import type { HubCtx } from '../../../plugins/hub-module';
import { HubSettingsSheet } from './settings-sheet';

const BASE = 'http://localhost:3000/guilds/9';

const VALHEIM_PAGE: GuildPageDto = {
    guild: {
        id: 9, gameId: 4, kind: 'game_server', name: 'gamersaloon', region: 'us', realmSlug: null, realmName: null,
        faction: null, memberCount: 3, lastSnapshotAt: null, gameSlug: 'valheim',
    },
    importedBy: null,
    viewer: { role: 'leader', canEdit: true, canManageEditors: true },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used by the settings sheet')),
};

let posts = 0;

function serve(mirror: GuildDiscordMirrorDto, welcome?: () => Response): void {
    server.use(
        http.get(`${BASE}/discord`, () => HttpResponse.json(mirror)),
        http.get(`${BASE}/editors`, () => HttpResponse.json({ editors: [] })),
        ...(welcome ? [http.post(`${BASE}/discord/welcome`, () => { posts += 1; return welcome(); })] : []),
    );
}

function renderSheet(page: GuildPageDto = VALHEIM_PAGE): void {
    const ctx: HubCtx = { page, raids: IDLE_RAIDS };
    renderWithProviders(<HubSettingsSheet ctx={ctx} module={undefined} onClose={() => undefined} onChangeChannel={() => undefined} />);
}

const welcome = (body: HubWelcomeResult) => (): Response => HttpResponse.json(body);
const REPOST = 'guild-settings-repost-welcome';

beforeEach(() => { posts = 0; });

describe('Re-post welcome message (ROK-1933)', () => {
    it('shows for a Valheim server hub with a bound channel, to its Leader', async () => {
        serve(okMirror([]));
        renderSheet();
        expect(await screen.findByTestId(REPOST)).toHaveTextContent('Re-post welcome message');
    });

    it('is hidden while no channel is bound', async () => {
        serve({ state: 'unset' });
        renderSheet();
        await screen.findByText('No channel chosen yet.');
        expect(screen.queryByTestId(REPOST), 'no channel → nothing to re-post into').toBeNull();
    });

    it('is hidden on a hub that is not a Valheim server', async () => {
        serve(okMirror([]));
        renderSheet({ ...VALHEIM_PAGE, guild: { ...VALHEIM_PAGE.guild, kind: 'wow_guild', gameSlug: 'world-of-warcraft' } });
        await screen.findByText('#announcements');
        expect(screen.queryByTestId(REPOST), 'the route 400s for any non-Valheim-server hub').toBeNull();
    });

    it('is hidden from a viewer the route would refuse (not Leader / staff)', async () => {
        serve(okMirror([]));
        renderSheet({ ...VALHEIM_PAGE, viewer: { role: 'officer', canEdit: true, canManageEditors: false } });
        await screen.findByTestId('guild-settings-sheet');
        expect(screen.queryByTestId(REPOST), 'GuildLeaderGuard refuses an officer').toBeNull();
    });

    it('reports a fresh post and its pin inline', async () => {
        serve(okMirror([]), welcome({ result: 'posted', pinned: true, warning: null }));
        renderSheet();
        await userEvent.click(await screen.findByTestId(REPOST));
        expect(await screen.findByTestId('guild-settings-welcome-result')).toHaveTextContent('Posted · pinned');
        expect(screen.queryByTestId('guild-settings-welcome-warning')).toBeNull();
        expect(posts).toBe(1);
    });

    it('reports an in-place edit and shows the pin warning as a warning line', async () => {
        const warning = 'Raid Ledger couldn’t pin it — give the bot Manage Messages.';
        serve(okMirror([]), welcome({ result: 'edited', pinned: false, warning }));
        renderSheet();
        await userEvent.click(await screen.findByTestId(REPOST));
        const result = await screen.findByTestId('guild-settings-welcome-result');
        expect(result).toHaveTextContent('Updated');
        expect(result).not.toHaveTextContent('pinned');
        expect(screen.getByTestId('guild-settings-welcome-warning')).toHaveTextContent(warning);
    });

    it('shows the server refusal inline', async () => {
        const message = 'Discord didn’t answer — nothing was posted, try again.';
        serve(okMirror([]), () => HttpResponse.json({ statusCode: 503, message }, { status: 503 }));
        renderSheet();
        await userEvent.click(await screen.findByTestId(REPOST));
        const error = await screen.findByTestId('guild-settings-welcome-error');
        expect(error).toHaveAttribute('role', 'alert');
        expect(error).toHaveTextContent(message);
        await waitFor(() => expect(screen.queryByTestId('guild-settings-welcome-result')).toBeNull());
    });
});
