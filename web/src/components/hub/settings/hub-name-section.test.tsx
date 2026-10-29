/**
 * ROK-1950 — "Hub name" in the hub settings sheet: community and server hubs
 * rename through `PATCH /guilds/:id/name`; an overridden server hub can reset
 * to the Pelican server's name (`{ name: null }`). ROK-2015: a WoW guild renames
 * too, and an overridden one resets to its in-game name.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuildPage as GuildPageDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { hubRenameError, hubRenameHandler, type HubRenameCall } from '../../../test/mocks/hub-rename-handlers';
import type { HubCtx } from '../../../plugins/hub-module';
import { HubNameSection } from './hub-name-section';

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('../../../lib/toast', () => ({ toast: toasts }));

const BASE_GUILD = { gameId: 1, region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 3, lastSnapshotAt: null } as const;

const COMMUNITY: GuildPageDto = {
    guild: { ...BASE_GUILD, id: 5, kind: 'game_community', name: 'Tav Party' },
    importedBy: null,
    viewer: { role: 'leader', canEdit: true, canManageEditors: true },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function serverPage(nameOverridden: boolean): GuildPageDto {
    return {
        ...COMMUNITY,
        guild: { ...BASE_GUILD, id: 9, kind: 'game_server', name: 'Saloon Crew', gameSlug: 'valheim', nameOverridden },
        server: { pelicanServerId: 3, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: true, serverName: 'gamersaloon' },
    };
}

const WOW_GUILD = { ...BASE_GUILD, id: 7, kind: 'wow_guild', realmName: 'Doomhowl', faction: 'Horde' } as const;

const WOW: GuildPageDto = {
    ...COMMUNITY,
    guild: { ...WOW_GUILD, name: 'Iron Vanguard', nameOverridden: false, inGameName: 'Iron Vanguard' },
};

const WOW_RENAMED: GuildPageDto = {
    ...COMMUNITY,
    guild: { ...WOW_GUILD, name: 'The Iron Lads', nameOverridden: true, inGameName: 'Iron Vanguard' },
};

const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used by the name section')),
};

function renderSection(page: GuildPageDto): void {
    renderWithProviders(<HubNameSection ctx={{ page, raids: IDLE_RAIDS }} />);
}

let calls: HubRenameCall[] = [];

beforeEach(() => {
    calls = [];
    toasts.error.mockReset();
    toasts.success.mockReset();
    server.use(hubRenameHandler(calls));
});

describe('HubNameSection (ROK-1950)', () => {
    it('keeps Save disabled until the trimmed draft changes and meets the minimum, then sends it', async () => {
        const user = userEvent.setup();
        renderSection(COMMUNITY);
        const input = screen.getByLabelText('Hub name');
        const save = screen.getByRole('button', { name: 'Save name' });
        expect(input).toHaveValue('Tav Party');
        expect(save, 'an unchanged name must not be saveable').toBeDisabled();
        await user.clear(input);
        await user.type(input, 'ab');
        expect(save, `a name shorter than the minimum must not be saveable`).toBeDisabled();
        await user.type(input, 'c Crew  ');
        expect(save).toBeEnabled();
        await user.click(save);
        await waitFor(() => expect(calls).toEqual([{ hubId: 5, body: { name: 'abc Crew' } }]));
        expect(toasts.success).toHaveBeenCalledWith('Hub renamed');
    });

    it('keeps Save disabled for a name the server schema rejects (no letter or digit)', async () => {
        const user = userEvent.setup();
        renderSection(COMMUNITY);
        const input = screen.getByLabelText('Hub name');
        await user.clear(input);
        await user.type(input, '!!!');
        expect(screen.getByRole('button', { name: 'Save name' }), 'punctuation only must not be saveable').toBeDisabled();
        expect(calls).toEqual([]);
    });

    it('a server hub with a Raid Ledger name offers "Reset to server name", which sends { name: null }', async () => {
        const user = userEvent.setup();
        renderSection(serverPage(true));
        expect(screen.getByText(/Pelican calls this server “gamersaloon”/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Reset to server name' }));
        await waitFor(() => expect(calls).toEqual([{ hubId: 9, body: { name: null } }]));
        expect(toasts.success).toHaveBeenCalledWith('Name reset to the server’s');
    });

    it('a server hub that follows its server name has no Reset button', () => {
        renderSection(serverPage(false));
        expect(screen.getByLabelText('Hub name')).toHaveValue('Saloon Crew');
        expect(screen.queryByRole('button', { name: 'Reset to server name' }), 'Reset shows only while overridden').toBeNull();
    });

    it('a 409 surfaces the server message in an error toast', async () => {
        const user = userEvent.setup();
        server.use(hubRenameError(409, 'A hub with that name already exists for this game'));
        renderSection(COMMUNITY);
        const input = screen.getByLabelText('Hub name');
        await user.clear(input);
        await user.type(input, 'Night Owls');
        await user.click(screen.getByRole('button', { name: 'Save name' }));
        await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('A hub with that name already exists for this game'));
    });

    it('a 403 gets plain copy instead of the guard message', async () => {
        const user = userEvent.setup();
        server.use(hubRenameError(403, 'Hub leader access required'));
        renderSection(COMMUNITY);
        await user.type(screen.getByLabelText('Hub name'), ' EU');
        await user.click(screen.getByRole('button', { name: 'Save name' }));
        await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Only the hub’s Leader or staff can rename it.'));
    });
});

describe('HubNameSection — WoW guild (ROK-2015)', () => {
    it('W1: a WoW guild renders the Hub name section (ROK-2015)', () => {
        renderSection(WOW);
        expect(screen.queryByTestId('hub-name-section'), 'WoW guilds now render the section').not.toBeNull();
        expect(screen.getByLabelText('Hub name')).toHaveValue('Iron Vanguard');
    });

    it('W2: a renamed WoW guild names its in-game name and "Reset to in-game name" sends { name: null }', async () => {
        const user = userEvent.setup();
        renderSection(WOW_RENAMED);
        expect(screen.getByText(/In game this guild is called “Iron Vanguard”\. LedgerLink imports keep the name you set here\./)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Reset to server name' }), 'WoW must not use the server copy').toBeNull();
        await user.click(screen.getByRole('button', { name: 'Reset to in-game name' }));
        await waitFor(() => expect(calls).toEqual([{ hubId: 7, body: { name: null } }]));
        expect(toasts.success).toHaveBeenCalledWith('Name reset to the in-game name');
    });

    it('W3: a WoW guild that follows its in-game name has no Reset button', () => {
        renderSection(WOW);
        expect(screen.queryByTestId('hub-name-section'), 'the section renders for a WoW guild').not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Reset to in-game name' }), 'Reset shows only while overridden').toBeNull();
        expect(screen.queryByTestId('hub-name-reset')).toBeNull();
    });

    it('W4: a WoW guild without an in-game name on record shows the base hint only', () => {
        renderSection({ ...WOW_RENAMED, guild: { ...WOW_GUILD, name: 'The Iron Lads', nameOverridden: true } });
        expect(screen.getByText('Shown on the hub, in the directory and on Discord.')).toBeInTheDocument();
        expect(screen.queryByText(/In game this guild is called/), 'no in-game hint without a name').toBeNull();
        expect(screen.queryByText(/undefined|null/)).toBeNull();
    });
});
