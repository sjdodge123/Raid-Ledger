/**
 * ROK-1786 (S2): the GM post on Overview, the Resources tab (rules, links,
 * recommended addons) and when that tab shows.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { GuildAddon, GuildAddonList, GuildPage as GuildPageDto, GuildProfile } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { at } from '../../../test/defined';
import { GuildPage } from '../hub-page';

const BASE = 'http://localhost:3000/plugins/wow/guilds/7';

function makePage(canEdit: boolean): GuildPageDto {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 1, lastSnapshotAt: null },
        importedBy: null,
        viewer: { role: canEdit ? 'officer' : 'member', canEdit, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

const EMPTY_PROFILE: GuildProfile = { guildId: 7, gmPost: null, rules: [], links: [] };
const NO_ADDONS: GuildAddonList = { pinned: [], addons: [] };

function addon(id: number, displayName: string, overrides: Partial<GuildAddon> = {}): GuildAddon {
    return {
        id, guildId: 7, source: 'curseforge', slugOrUrl: displayName.toLowerCase(), url: `https://www.curseforge.com/wow/addons/${displayName.toLowerCase()}`,
        displayName, note: null, requirement: 'optional', flavor: null, sortOrder: id, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...overrides,
    };
}

interface Call { method: string; url: string; body: unknown }
let calls: Call[] = [];

async function record(request: Request): Promise<void> {
    const text = await request.text();
    calls.push({ method: request.method, url: request.url, body: text ? JSON.parse(text) : null });
}

function serve(canEdit: boolean, profile: GuildProfile = EMPTY_PROFILE, addons: GuildAddonList = NO_ADDONS): void {
    server.use(
        http.get(BASE, () => HttpResponse.json(makePage(canEdit))),
        http.get(`${BASE}/profile`, () => HttpResponse.json(profile)),
        http.patch(`${BASE}/profile`, async ({ request }) => { await record(request); return HttpResponse.json(profile); }),
        http.get(`${BASE}/addons`, () => HttpResponse.json(addons)),
        http.post(`${BASE}/addons`, async ({ request }) => { await record(request); return HttpResponse.json(addon(99, 'Details')); }),
        http.delete(`${BASE}/addons/:addonId`, async ({ request }) => { await record(request); return new HttpResponse(null, { status: 204 }); }),
        http.put(`${BASE}/addons/order`, async ({ request }) => { await record(request); return HttpResponse.json(addons); }),
    );
}

function renderPage(hash = ''): void {
    window.location.hash = hash;
    renderWithProviders(<Routes><Route path="/guilds/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/guilds/7'] });
}

async function tabLabels(): Promise<(string | null)[]> {
    const nav = await screen.findByRole('navigation', { name: 'Guild page sections' });
    return within(nav).getAllByRole('link').map((a) => a.textContent);
}

beforeEach(() => { calls = []; });
afterEach(() => { window.location.hash = ''; });

describe('GM post (Overview)', () => {
    const post: GuildProfile = { ...EMPTY_PROFILE, gmPost: { body: 'Raid Thursday 8pm.\nBring flasks.', updatedAt: '2026-10-03T12:00:00.000Z', updatedBy: 'Grimtusk' } };

    it('shows the body and author to a viewer, with no Edit', async () => {
        serve(false, post);
        renderPage();
        expect(await screen.findByTestId('guild-gm-post-body')).toHaveTextContent('Raid Thursday 8pm.');
        expect(screen.getByTestId('guild-gm-post-byline')).toHaveTextContent('Grimtusk');
        expect(screen.queryByRole('button', { name: 'Edit the guild post' }), 'a viewer must not get Edit').toBeNull();
    });

    it('shows an empty state to a viewer when there is no post', async () => {
        serve(false);
        renderPage();
        expect(await screen.findByTestId('guild-gm-post-empty')).toHaveTextContent('No post from the guild master yet.');
        expect(screen.queryByRole('button', { name: 'Add a post' })).toBeNull();
    });

    it('lets an editor add a post and PATCHes the profile', async () => {
        serve(true);
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Add a post' }));
        await userEvent.type(screen.getByLabelText('Guild post'), 'Welcome raiders');
        await userEvent.click(screen.getByTestId('guild-gm-post-save'));
        await waitFor(() => expect(calls).toEqual([{ method: 'PATCH', url: `${BASE}/profile`, body: { gmPost: 'Welcome raiders' } }]));
    });

    it('shows the loading skeleton, not Add a post, to an editor while the profile loads', async () => {
        serve(true);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        server.use(http.get(`${BASE}/profile`, async () => { await gate; return HttpResponse.json(EMPTY_PROFILE); }));
        renderPage();
        expect(await screen.findByTestId('guild-gm-post-loading')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Add a post' }), 'no Add a post before the profile loads').toBeNull();
        release();
        expect(await screen.findByRole('button', { name: 'Add a post' })).toBeInTheDocument();
        expect(screen.queryByTestId('guild-gm-post-loading')).toBeNull();
    });

    it('shows an error, not the empty prompt, to an editor when the profile fails', async () => {
        serve(true);
        server.use(http.get(`${BASE}/profile`, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderPage();
        expect(await screen.findByTestId('guild-gm-post-error')).toHaveTextContent('Couldn’t load the guild post.');
        expect(screen.queryByTestId('guild-gm-post-prompt'), 'no empty prompt on a profile error').toBeNull();
        expect(screen.queryByRole('button', { name: 'Add a post' })).toBeNull();
    });
});

describe('Resources tab visibility', () => {
    it('stays hidden for a viewer when there is nothing in it', async () => {
        serve(false);
        renderPage();
        await screen.findByTestId('guild-gm-post-empty');
        expect(await tabLabels()).toEqual(['Overview', 'Roster', 'Raids']);
    });

    it('shows for a viewer once there is content', async () => {
        serve(false, { ...EMPTY_PROFILE, rules: [{ title: 'Loot', body: 'Need before greed' }] });
        renderPage();
        await waitFor(async () => expect(await tabLabels()).toEqual(['Overview', 'Roster', 'Raids', 'Resources']));
    });

    it('shows for an editor even when empty', async () => {
        serve(true);
        renderPage();
        await waitFor(async () => expect(await tabLabels()).toEqual(['Overview', 'Roster', 'Raids', 'Resources']));
    });
});

describe('Resources: rules and links', () => {
    it('renders each non-blank rule line as an item', async () => {
        serve(false, { ...EMPTY_PROFILE, rules: [{ title: 'Loot', body: 'Need before greed\n\n   \n  Main spec first  ' }] });
        renderPage('#resources');
        const items = await screen.findByTestId('guild-rule-items');
        expect(within(items).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Need before greed', 'Main spec first']);
    });

    it('an editor adds a rules section and saves the whole list', async () => {
        serve(true, { ...EMPTY_PROFILE, rules: [{ title: 'Loot', body: 'Need before greed' }] });
        renderPage('#resources');
        await userEvent.click(await screen.findByTestId('guild-rules-edit'));
        await userEvent.click(screen.getByRole('button', { name: 'Add section' }));
        const titles = screen.getAllByLabelText('Section title');
        await userEvent.type(at(titles, 1), 'Attendance');
        await userEvent.type(at(screen.getAllByLabelText('Rules'), 1), 'Sign up by Tuesday');
        await userEvent.click(screen.getByRole('button', { name: 'Move Attendance up' }));
        await userEvent.click(screen.getByTestId('guild-rules-save'));
        await waitFor(() => expect(calls[0]?.body).toEqual({ rules: [{ title: 'Attendance', body: 'Sign up by Tuesday' }, { title: 'Loot', body: 'Need before greed' }] }));
    });

    it('an editor adds a link group and saves it', async () => {
        serve(true);
        renderPage('#resources');
        await userEvent.click(await screen.findByTestId('guild-links-edit'));
        await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
        await userEvent.type(screen.getByLabelText('Group title'), 'Logs');
        await userEvent.type(screen.getByLabelText('Label'), 'Warcraft Logs');
        await userEvent.type(screen.getByLabelText('URL'), 'https://classic.warcraftlogs.com/guild/1');
        await userEvent.click(screen.getByTestId('guild-links-save'));
        await waitFor(() => expect(calls[0]?.body).toEqual({ links: [{ title: 'Logs', links: [{ label: 'Warcraft Logs', url: 'https://classic.warcraftlogs.com/guild/1' }] }] }));
    });
});

const list: GuildAddonList = {
    pinned: [{ name: 'LedgerLink', url: 'https://github.com/sjdodge123/ledger-link', note: null, requirement: 'required', flavors: [] }],
    addons: [addon(1, 'DBM', { requirement: 'required' }), addon(2, 'Details')],
};

describe('Resources: recommended addons', () => {

    it('lists pinned first, then the guild addons; a viewer gets no controls', async () => {
        serve(false, EMPTY_PROFILE, list);
        renderPage('#resources');
        const ul = await screen.findByRole('list', { name: 'Recommended addons' });
        const names = within(ul).getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent);
        expect(names).toEqual(['LedgerLink', 'DBM', 'Details']);
        expect(within(at(within(ul).getAllByRole('listitem'), 0)).getByText('Pinned')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove DBM' }), 'viewer must not get Remove').toBeNull();
    });

    it('an editor cannot remove a pinned addon but can add, remove and reorder', async () => {
        serve(true, EMPTY_PROFILE, list);
        renderPage('#resources');
        await screen.findByRole('button', { name: 'Remove DBM' });
        expect(screen.queryByRole('button', { name: 'Remove LedgerLink' }), 'pinned rows are fixed').toBeNull();
        await userEvent.type(screen.getByLabelText('Addon link'), 'https://www.curseforge.com/wow/addons/details');
        expect(screen.getByTestId('guild-addon-preview')).toHaveTextContent('Adding Details');
        await userEvent.click(screen.getByTestId('guild-addon-add'));
        await waitFor(() => expect(calls.at(-1)).toEqual({ method: 'POST', url: `${BASE}/addons`, body: { url: 'https://www.curseforge.com/wow/addons/details', note: null, requirement: 'optional', flavor: null } }));
        await userEvent.click(screen.getByRole('button', { name: 'Remove DBM' }));
        await waitFor(() => expect(calls.at(-1)).toEqual({ method: 'DELETE', url: `${BASE}/addons/1`, body: null }));
        await userEvent.click(screen.getByRole('button', { name: 'Move DBM down' }));
        await waitFor(() => expect(calls.at(-1)).toEqual({ method: 'PUT', url: `${BASE}/addons/order`, body: { ids: [2, 1] } }));
    });
});

describe('Resources: addon write failures', () => {
    it('a failed edit keeps the editor open with the server error; a retry that succeeds closes it', async () => {
        serve(true, EMPTY_PROFILE, list);
        let fail = true;
        server.use(http.patch(`${BASE}/addons/:addonId`, async ({ request }) => {
            await record(request);
            return fail
                ? HttpResponse.json({ message: 'Note is too long' }, { status: 400 })
                : HttpResponse.json(addon(1, 'DBM', { note: 'Boss timers' }));
        }));
        renderPage('#resources');
        await userEvent.click(await screen.findByRole('button', { name: 'Edit DBM' }));
        // The add form above the list has its own Note; the row editor's is second.
        const rowNote = (): HTMLElement => at(screen.getAllByLabelText('Note'), 1);
        await userEvent.type(rowNote(), 'Boss timers');
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        expect(await screen.findByTestId('guild-addon-edit-error')).toHaveTextContent('Couldn’t save DBM. Note is too long');
        expect(rowNote(), 'the edit must survive a failed save').toHaveValue('Boss timers');
        fail = false;
        await userEvent.click(screen.getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(screen.getAllByLabelText('Note'), 'the editor closes once the save lands').toHaveLength(1));
        expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
    });

    it('a failed remove or reorder shows the server error above the list', async () => {
        serve(true, EMPTY_PROFILE, list);
        server.use(
            http.delete(`${BASE}/addons/:addonId`, () => HttpResponse.json({ message: 'Addon not found' }, { status: 404 })),
            http.put(`${BASE}/addons/order`, () => HttpResponse.json({ message: 'ids must list every addon of the guild' }, { status: 400 })),
        );
        renderPage('#resources');
        await userEvent.click(await screen.findByRole('button', { name: 'Remove DBM' }));
        expect(await screen.findByTestId('guild-addons-error')).toHaveTextContent('Couldn’t remove that addon. Addon not found');
        await userEvent.click(screen.getByRole('button', { name: 'Move DBM down' }));
        await waitFor(() => expect(screen.getByTestId('guild-addons-error')).toHaveTextContent('Couldn’t move that addon. ids must list every addon of the guild'));
    });

    it('a rejected add shows the server message, and a bad known-host link is caught before submit', async () => {
        serve(true, EMPTY_PROFILE, list);
        server.use(http.post(`${BASE}/addons`, () => HttpResponse.json({ message: 'This addon is already on the guild list' }, { status: 409 })));
        renderPage('#resources');
        const input = await screen.findByLabelText('Addon link');
        await userEvent.type(input, 'https://www.curseforge.com/wow/other/details');
        expect(screen.getByRole('alert')).toHaveTextContent('CurseForge links must look like curseforge.com/wow/addons/<name>');
        expect(screen.getByTestId('guild-addon-add')).toBeDisabled();
        await userEvent.clear(input);
        await userEvent.type(input, 'https://www.curseforge.com/wow/addons/dbm');
        await userEvent.click(screen.getByTestId('guild-addon-add'));
        expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t add that addon. This addon is already on the guild list');
    });
});
