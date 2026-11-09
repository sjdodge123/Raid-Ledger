/**
 * ROK-2147 — editors can set and clear a recommendation's addon folder name
 * (the Installed / Missing match key on the character page).
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { GUILD_ADDON_FOLDER_NAME_MAX, type GuildAddonList, type GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { guildAddonFixture } from '../../../test/mocks/installed-addons-handlers';
import { GuildAddonsSection } from './guild-addons';

const PAGE = 'http://localhost:3000/guilds/7';
const ADDONS = 'http://localhost:3000/plugins/wow/guilds/7/addons';
const URL = 'https://www.curseforge.com/wow/addons/details';
const EXISTING = guildAddonFixture(5, { guildId: 7, displayName: 'Deadly Boss Mods', folderName: 'DBM-Core' });

const PAGE_BODY: GuildPage = {
    guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'officer', canEdit: true, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function serve(sent: { posted: unknown[]; patched: unknown[] }): void {
    const list: GuildAddonList = { pinned: [], addons: [EXISTING] };
    server.use(
        http.get(PAGE, () => HttpResponse.json(PAGE_BODY)),
        http.get(ADDONS, () => HttpResponse.json(list)),
        http.post(ADDONS, async ({ request }) => { sent.posted.push(await request.json()); return HttpResponse.json(guildAddonFixture(9, { guildId: 7 })); }),
        http.patch(`${ADDONS}/5`, async ({ request }) => { sent.patched.push(await request.json()); return HttpResponse.json(EXISTING); }),
    );
}

const form = (): HTMLElement => screen.getByTestId('guild-addon-form');

describe('Addon folder name on guild recommendations (ROK-2147)', () => {
    it('the Add form sends a trimmed folder name, capped at the contract max', async () => {
        const sent = { posted: [] as unknown[], patched: [] as unknown[] };
        serve(sent);
        renderWithProviders(<GuildAddonsSection guildId={7} canEdit />);
        const input = await within(await screen.findByTestId('guild-addon-form')).findByLabelText('Addon folder name');
        expect(input).toHaveAttribute('maxLength', String(GUILD_ADDON_FOLDER_NAME_MAX));
        await userEvent.type(within(form()).getByLabelText('Addon link'), URL);
        await userEvent.type(input, '  Details  ');
        await userEvent.click(screen.getByTestId('guild-addon-add'));
        await waitFor(() => expect(sent.posted).toEqual([expect.objectContaining({ url: URL, folderName: 'Details' })]));
    });

    it('editing a row shows its folder name and clearing it sends null', async () => {
        const sent = { posted: [] as unknown[], patched: [] as unknown[] };
        serve(sent);
        renderWithProviders(<GuildAddonsSection guildId={7} canEdit />);
        await userEvent.click(await screen.findByRole('button', { name: 'Edit Deadly Boss Mods' }));
        const editor = screen.getByTestId('guild-addon-row');
        const input = within(editor).getByLabelText('Addon folder name');
        expect(input).toHaveValue('DBM-Core');
        await userEvent.clear(input);
        await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
        await waitFor(() => expect(sent.patched).toEqual([expect.objectContaining({ folderName: null })]));
    });
});
