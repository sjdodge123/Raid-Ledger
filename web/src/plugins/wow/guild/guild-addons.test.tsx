/**
 * ROK-2114 — a WoW: Forever guild's Recommended mods panel opens on Forever
 * (filter AND the Add addon form), resets the form back to Forever after an
 * add, and never overwrites a choice the user made before the hub loaded.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildAddon, GuildAddonList, GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import { GuildAddonsSection } from './guild-addons';

const PAGE = 'http://localhost:3000/guilds/7';
const ADDONS = 'http://localhost:3000/plugins/wow/guilds/7/addons';
const LIST: GuildAddonList = { pinned: [], addons: [] };
const URL = 'https://www.curseforge.com/wow/addons/details';

function page(gameSlug?: string): GuildPage {
    return {
        guild: {
            id: 7, gameId: 1, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 1, lastSnapshotAt: null, ...(gameSlug ? { gameSlug } : {}),
        },
        importedBy: null,
        viewer: { role: 'officer', canEdit: true, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function added(flavor: GuildAddon['flavor']): GuildAddon {
    return {
        id: 99, guildId: 7, source: 'curseforge', slugOrUrl: 'details', url: URL, displayName: 'Details', note: null,
        requirement: 'optional', flavor, sortOrder: 1, createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z',
    };
}

function serve(pageReply: () => Promise<Response> | Response, posted: unknown[] = []): void {
    server.use(
        http.get(PAGE, pageReply),
        http.get(ADDONS, () => HttpResponse.json(LIST)),
        http.post(ADDONS, async ({ request }) => {
            const body = (await request.json()) as { flavor: GuildAddon['flavor'] };
            posted.push(body);
            return HttpResponse.json(added(body.flavor));
        }),
    );
}

function render(): ReturnType<typeof createTestQueryClient> {
    const queryClient = createTestQueryClient();
    renderWithProviders(<GuildAddonsSection guildId={7} canEdit />, { queryClient });
    return queryClient;
}

const formFlavor = (): HTMLSelectElement => within(screen.getByTestId('guild-addon-form')).getByLabelText<HTMLSelectElement>('Flavor');

describe('Recommended mods default flavor (ROK-2114)', () => {
    it('a Forever guild opens on Forever in the filter and the Add addon form', async () => {
        serve(() => HttpResponse.json(page('world-of-warcraft-forever')));
        render();
        await waitFor(() => expect(screen.getByRole('radio', { name: 'Forever' }), 'the filter pre-selects Forever').toBeChecked());
        expect(formFlavor().value, 'the Add form pre-selects Forever').toBe('forever');
        expect(screen.getByRole('radio', { name: 'Classic' }), 'other flavors stay selectable').toBeEnabled();
        expect(screen.getByRole('radio', { name: 'Retail' })).toBeEnabled();
    });

    it('a guild with no known flavor keeps All and Any flavor', async () => {
        serve(() => HttpResponse.json(page()));
        const queryClient = render();
        await waitFor(() => expect(
            queryClient.getQueriesData({ queryKey: guildPageKey(7) }).some(([, data]) => data !== undefined), 'the hub page loaded',
        ).toBe(true));
        expect(await screen.findByRole('radio', { name: 'All' })).toBeChecked();
        expect(formFlavor().value).toBe('any');
    });

    it('after a successful add the form resets back to Forever', async () => {
        const posted: unknown[] = [];
        serve(() => HttpResponse.json(page('world-of-warcraft-forever')), posted);
        render();
        await waitFor(() => expect(formFlavor().value).toBe('forever'));
        await userEvent.selectOptions(formFlavor(), 'retail');
        await userEvent.type(screen.getByLabelText('Addon link'), URL);
        await userEvent.click(screen.getByTestId('guild-addon-add'));
        await waitFor(() => expect(posted).toEqual([{ url: URL, note: null, requirement: 'optional', flavor: 'retail' }]));
        await waitFor(() => expect(screen.getByLabelText('Addon link')).toHaveValue(''));
        expect(formFlavor().value, 'reset returns to the guild flavor, not Any flavor').toBe('forever');
    });

    it('a filter choice made before the hub loads is not overwritten when it arrives', async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        serve(async () => { await gate; return HttpResponse.json(page('world-of-warcraft-forever')); });
        render();
        await userEvent.click(await screen.findByRole('radio', { name: 'Retail' }));
        release();
        await waitFor(() => expect(formFlavor().value, 'the untouched form picks the late flavor up').toBe('forever'));
        expect(screen.getByRole('radio', { name: 'Retail' }), 'the user’s filter choice survives').toBeChecked();
    });
});
