/**
 * ROK-1813 (D10) — the "Public recruiting card" settings section: the switch
 * PATCHes `{enabled}`, the link + copy button appear only while on, and a
 * viewer without `canEdit` gets no section and no request.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildPublicCardSettings, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import {
    guildPublicCardSettingsHandlers, SEEDED_PUBLIC_GUILD_SLUG, type PublicCardSettingsLog,
} from '../../../test/mocks/public-guild-card-handlers';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubCtx } from '../../hub-module';
import { PublicCardSettingsSection } from './public-card-settings-section';
import { publicCardUrl } from './public-card-settings.helpers';

function guildPage(canEdit: boolean): GuildPage {
    return {
        guild: {
            id: 7, gameId: 3, kind: 'wow_guild', name: 'Ye Olde Guild', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 4, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever',
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

let log: PublicCardSettingsLog;

function renderSection(initial: GuildPublicCardSettings, page: GuildPage = guildPage(true)): void {
    server.use(...guildPublicCardSettingsHandlers(initial, log));
    renderWithProviders(<WithCtx page={page}>{(ctx) => <PublicCardSettingsSection {...ctx} />}</WithCtx>);
}

beforeEach(() => { log = { calls: [], bodies: [] }; });

describe('PublicCardSettingsSection', () => {
    it('starts off with no link, and says what is never shown', async () => {
        renderSection({ enabled: false, slug: null });
        expect(await screen.findByRole('switch', { name: 'Public recruiting card' })).not.toBeChecked();
        expect(screen.queryByTestId('wow-public-card-link'), 'no link while off').not.toBeInTheDocument();
        expect(screen.getByTestId('wow-public-card-never')).toHaveTextContent('Never shown: roster, member names');
    });

    it('turning it on PATCHes {enabled:true} and shows the link with a copy button', async () => {
        renderSection({ enabled: false, slug: null });
        await userEvent.click(await screen.findByRole('switch', { name: 'Public recruiting card' }));
        await waitFor(() => expect(log.bodies).toEqual([{ enabled: true }]));
        expect(log.calls).toContain('PATCH /plugins/wow/guilds/7/public-card');
        const link = await screen.findByTestId('wow-public-card-link');
        expect(link).toHaveValue(`${window.location.origin}/p/guild/${SEEDED_PUBLIC_GUILD_SLUG}`);
        expect(link).toHaveAttribute('readonly');
        expect(screen.getByTitle('Copy to clipboard')).toBeInTheDocument();
        expect(screen.getByRole('switch', { name: 'Public recruiting card' })).toBeChecked();
    });

    it('turning it off PATCHes {enabled:false} and hides the link', async () => {
        renderSection({ enabled: true, slug: SEEDED_PUBLIC_GUILD_SLUG });
        await screen.findByTestId('wow-public-card-link');
        await userEvent.click(screen.getByRole('switch', { name: 'Public recruiting card' }));
        await waitFor(() => expect(log.bodies).toEqual([{ enabled: false }]));
        await waitFor(() => expect(screen.queryByTestId('wow-public-card-link')).not.toBeInTheDocument());
    });

    it('renders nothing and fetches nothing for a viewer without canEdit', () => {
        renderSection({ enabled: true, slug: SEEDED_PUBLIC_GUILD_SLUG }, guildPage(false));
        expect(screen.queryByTestId('wow-public-card-section')).not.toBeInTheDocument();
        expect(log.calls).toEqual([]);
    });

    it('ROK-1813 N1: a rank-0 GM without an editor grant gets no section', () => {
        const page = guildPage(false);
        renderSection({ enabled: false, slug: null }, { ...page, viewer: { ...page.viewer, isGuildMaster: true } });
        expect(screen.queryByTestId('wow-public-card-section')).not.toBeInTheDocument();
        expect(log.calls).toEqual([]);
    });

    it('publicCardUrl builds the absolute /p/guild/:slug address', () => {
        expect(publicCardUrl('Xk3pQ9aL2mWv7RtB', 'https://raid.example')).toBe('https://raid.example/p/guild/Xk3pQ9aL2mWv7RtB');
    });
});
