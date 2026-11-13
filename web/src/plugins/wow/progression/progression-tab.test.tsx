/**
 * ROK-1789 Part B (B-4) — the Progression tab: one section per instance from
 * `GET /plugins/wow/guilds/:id/progression`, the activity feed column (LB7's
 * `ActivityFeed`, mocked here), the empty copy, and the error alert.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { JSX } from 'react';
import type { GuildPage, WowGuildActivityDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildProgressionInstance, buildProgressionPage, guildProgressionGetHandler } from '../../../test/mocks/guild-progression-handlers';
import { RAID_PROGRESS_EMPTY_COPY } from '../hub-widgets/raid-progress.helpers';
import type { HubCtx } from '../../hub-module';
import ProgressionTab from './progression-tab';

vi.mock('./activity-feed', () => ({
    ActivityFeed: ({ activity }: { activity: WowGuildActivityDto }): JSX.Element => (
        <div data-testid="activity-feed-stub">{activity.windowDays} days</div>
    ),
}));

function ctx(): Pick<HubCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 42, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

describe('ProgressionTab', () => {
    it('renders one section per instance in API order and the activity feed column', async () => {
        const other = buildProgressionInstance({ key: 'other', name: 'Other bosses', bossTotal: null, bossesDown: 1, latestKill: null });
        server.use(guildProgressionGetHandler(buildProgressionPage([buildProgressionInstance(), other])));
        renderWithProviders(<ProgressionTab {...ctx()} />);
        const headings = await screen.findAllByRole('heading', { level: 3 });
        expect(headings.map((h) => h.textContent)).toEqual(['Molten Core', 'Other bosses']);
        expect(screen.getByTestId('progression-feed')).toContainElement(screen.getByTestId('activity-feed-stub'));
        expect(screen.getByTestId('wow-progression-tab')).toHaveClass('lg:grid');
    });

    it('shows the raid-progress empty copy when there are no instances, and still renders the feed', async () => {
        renderWithProviders(<ProgressionTab {...ctx()} />);
        expect(await screen.findByTestId('progression-empty')).toHaveTextContent(RAID_PROGRESS_EMPTY_COPY);
        expect(screen.getByTestId('activity-feed-stub')).toBeInTheDocument();
    });

    it('shows an alert when the request fails', async () => {
        server.use(guildProgressionGetHandler('error'));
        renderWithProviders(<ProgressionTab {...ctx()} />);
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load raid progression.");
        expect(screen.queryByTestId('activity-feed-stub')).not.toBeInTheDocument();
    });
});
