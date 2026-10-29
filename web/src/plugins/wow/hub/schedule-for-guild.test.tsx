/**
 * ROK-2050 — the WoW guild module's `eventsLead` puts "Schedule for guild" on
 * the core Events tab: editors only, same Create Event deep link as the Raids tab.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { renderWithProviders } from '../../../test/render-helpers';
import { wowHubModule } from './register-hub';

const TESTID = 'guild-schedule-for-guild';
const raids = {} as HubCtx['raids'];

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
        const Lead = wowHubModule.eventsLead;
        expect(Lead, 'the WoW guild module must fill the eventsLead slot').toBeDefined();
        if (!Lead) return;
        renderWithProviders(<Lead page={page(true)} raids={raids} />);
        const link = screen.getByTestId(TESTID);
        expect(link).toHaveTextContent('Schedule for guild');
        expect(link).toHaveAttribute('href', '/events/new?gameId=3&guildId=7');
    });

    it('a plain member does not see it', () => {
        const Lead = wowHubModule.eventsLead;
        expect(Lead, 'the WoW guild module must fill the eventsLead slot').toBeDefined();
        if (!Lead) return;
        renderWithProviders(<Lead page={page(false)} raids={raids} />);
        expect(screen.queryByTestId(TESTID), 'a non-editor must not get "Schedule for guild"').toBeNull();
    });
});
