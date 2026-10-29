/**
 * ROK-2050 — the WoW guild module's `eventsLead` puts "Schedule for guild" on
 * the core Events tab: editors only, same Create Event deep link as the Raids tab.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { wowHubModule } from './register-hub';
import { WowEventsLead } from './schedule-for-guild';

const TESTID = 'guild-schedule-for-guild';

function page(canEdit: boolean): GuildPage {
    return {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Iron Vanguard', region: 'us', realmSlug: null, realmName: 'Doomhowl', faction: 'Horde', memberCount: 1, lastSnapshotAt: null },
        importedBy: null,
        viewer: { role: canEdit ? 'officer' : 'member', canEdit, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

describe('wowHubModule.eventsLead — Schedule for guild on the Events tab (ROK-2050)', () => {
    it('an editor sees the link, pointing at Create Event pre-linked to this guild', () => {
        expect(wowHubModule.eventsLead, 'the WoW guild module must fill the eventsLead slot').toBe(WowEventsLead);
        renderWithProviders(<WowEventsLead page={page(true)} />);
        const link = screen.getByTestId(TESTID);
        expect(link).toHaveTextContent('Schedule for guild');
        expect(link).toHaveAttribute('href', '/events/new?gameId=3&guildId=7');
    });

    it('a plain member does not see it', () => {
        expect(wowHubModule.eventsLead, 'the WoW guild module must fill the eventsLead slot').toBe(WowEventsLead);
        renderWithProviders(<WowEventsLead page={page(false)} />);
        expect(screen.queryByTestId(TESTID), 'a non-editor must not get "Schedule for guild"').toBeNull();
    });
});
