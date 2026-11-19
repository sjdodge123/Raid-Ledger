/**
 * ROK-1813 (D10) — the WoW hub module's settings slot stacks the Blizzard
 * roster section and the public recruiting card section.
 */
import type { JSX, ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { blizzardRosterHandlers, buildBlizzardRosterView } from '../../../test/mocks/blizzard-roster-handlers';
import { guildPublicCardSettingsHandlers } from '../../../test/mocks/public-guild-card-handlers';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubCtx } from '../../hub-module';
import { wowHubModule } from '../hub/register-hub';
import { WowSettingsSections } from './wow-settings-sections';

const PAGE: GuildPage = {
    guild: {
        id: 7, gameId: 3, kind: 'wow_guild', name: 'Ye Olde Guild', region: 'us', realmSlug: null, realmName: null,
        faction: null, memberCount: 4, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever',
    },
    importedBy: null,
    viewer: { role: 'officer', canEdit: true, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function WithCtx({ children }: { children: (ctx: HubCtx) => ReactNode }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test-raids'], queryFn: () => new Promise<GuildRaidsDto>(() => undefined), enabled: false });
    return <>{children({ page: PAGE, raids })}</>;
}

describe('WowSettingsSections', () => {
    it('is the WoW hub module’s settings hook', () => {
        expect(wowHubModule.settingsSections).toBe(WowSettingsSections);
    });

    it('renders the Blizzard roster section and then the public card section', async () => {
        server.use(...blizzardRosterHandlers(buildBlizzardRosterView()), ...guildPublicCardSettingsHandlers({ enabled: false, slug: null }, { calls: [], bodies: [] }));
        renderWithProviders(<WithCtx>{(ctx) => <WowSettingsSections {...ctx} />}</WithCtx>);
        const roster = await screen.findByTestId('wow-blizzard-roster-section');
        const card = await screen.findByTestId('wow-public-card-section');
        expect(roster.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING, 'the card section sits below the roster').toBeTruthy();
    });
});
