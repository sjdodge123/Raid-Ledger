/**
 * ROK-1928 A4/D2 — the Forever guild hub's "Blizzard roster" settings section.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { GuildBlizzardRosterView, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import {
    blizzardRosterBodies, blizzardRosterCalls, blizzardRosterHandlers, buildBlizzardRosterView, resetBlizzardRosterCalls,
} from '../../../test/mocks/blizzard-roster-handlers';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubCtx } from '../../hub-module';
import { wowHubModule } from '../hub/register-hub';
import { BlizzardRosterSection } from './blizzard-roster-section';

function foreverPage(canEdit: boolean, gameSlug = 'world-of-warcraft-forever'): GuildPage {
    return {
        guild: {
            id: 7, gameId: 3, kind: 'wow_guild', name: 'Ye Olde Guild', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 4, lastSnapshotAt: null, gameSlug,
        },
        importedBy: null,
        viewer: { role: canEdit ? 'officer' : 'member', canEdit, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function WithCtx({ page, children }: { page: GuildPage; children: (ctx: HubCtx) => ReactNode }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <>{children({ page, raids })}</>;
}

function renderSection(view: GuildBlizzardRosterView, page: GuildPage = foreverPage(true)): void {
    server.use(...blizzardRosterHandlers(view));
    renderWithProviders(<WithCtx page={page}>{(ctx) => <BlizzardRosterSection {...ctx} />}</WithCtx>);
}

const TWO_HOURS_AGO = new Date(Date.now() - 2 * 3_600_000).toISOString();

beforeEach(() => resetBlizzardRosterCalls());

describe('BlizzardRosterSection', () => {
    it('is the WoW hub module’s settings hook', () => {
        expect(wowHubModule.settingsSections).toBe(BlizzardRosterSection);
    });

    it.each([
        ['ok', TWO_HOURS_AGO, 'Roster via Blizzard · synced 2 h ago'],
        ['not_found', TWO_HOURS_AGO, "Blizzard didn't find this guild — showing the LedgerLink roster"],
        ['error', TWO_HOURS_AGO, 'Last Blizzard sync failed — showing the last roster'],
        ['skipped_empty', TWO_HOURS_AGO, 'Blizzard returned an empty roster — kept the last one'],
    ] as const)('status %s renders its line', async (status, syncedAt, line) => {
        renderSection(buildBlizzardRosterView({ guildSlug: 'ye-olde-guild', status, syncedAt }));
        expect(await screen.findByTestId('wow-blizzard-roster-status')).toHaveTextContent(line);
    });

    it('prefills the suggestion and Save PATCHes the slug', async () => {
        renderSection(buildBlizzardRosterView());
        const input = await screen.findByTestId('wow-blizzard-roster-input');
        expect(input).toHaveValue('ye-olde-guild');
        await userEvent.clear(input);
        await userEvent.type(input, 'olde-guild');
        await userEvent.click(screen.getByTestId('wow-blizzard-roster-save'));
        await waitFor(() => expect(blizzardRosterBodies).toEqual([{ guildSlug: 'olde-guild' }]));
        expect(blizzardRosterCalls).toContain('PATCH /plugins/wow/guilds/7/blizzard-roster');
    });

    it('hides Sync now until a slug is stored', async () => {
        renderSection(buildBlizzardRosterView());
        await screen.findByTestId('wow-blizzard-roster-input');
        expect(screen.queryByTestId('wow-blizzard-roster-sync')).not.toBeInTheDocument();
    });

    it('Sync now POSTs the sync route once a slug is stored', async () => {
        renderSection(buildBlizzardRosterView({ guildSlug: 'ye-olde-guild' }));
        await userEvent.click(await screen.findByTestId('wow-blizzard-roster-sync'));
        await waitFor(() => expect(blizzardRosterCalls).toContain('POST /plugins/wow/guilds/7/blizzard-roster/sync'));
    });

    it('a non-editor sees the slug but no input', async () => {
        renderSection(buildBlizzardRosterView({ guildSlug: 'ye-olde-guild' }), foreverPage(false));
        expect(await screen.findByTestId('wow-blizzard-roster-slug')).toHaveTextContent('Blizzard guild: ye-olde-guild');
        expect(screen.queryByTestId('wow-blizzard-roster-input')).not.toBeInTheDocument();
    });

    it('renders nothing and fetches nothing off a Forever hub', () => {
        renderSection(buildBlizzardRosterView(), foreverPage(true, 'world-of-warcraft'));
        expect(screen.queryByTestId('wow-blizzard-roster-section')).not.toBeInTheDocument();
        expect(blizzardRosterCalls).toEqual([]);
    });
});
