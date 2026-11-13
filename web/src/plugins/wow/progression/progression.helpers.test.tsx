/**
 * ROK-1789 Part B (Q-B15, B10) — the Progression tab shows on a WoW: Forever
 * guild for members and staff only; a visitor and a non-Forever guild never see it.
 */
import { describe, it, expect } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import { progressionTabVisible } from './progression.helpers';
import { wowHubModule } from '../hub/register-hub';

function page(gameSlug: string, viewer: Partial<GuildPage['viewer']> = {}): GuildPage {
    return {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 42, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false, ...viewer },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

describe('progressionTabVisible', () => {
    it('shows the tab to a member of a Forever guild', () => {
        expect(progressionTabVisible({ page: page('world-of-warcraft-forever') })).toBe(true);
    });

    it('hides it from a visitor', () => {
        expect(progressionTabVisible({ page: page('world-of-warcraft-forever', { role: 'visitor' }) })).toBe(false);
    });

    it('shows it to staff who are not members (the API answers staff too)', () => {
        expect(progressionTabVisible({ page: page('world-of-warcraft-forever', { role: 'visitor', isStaff: true }) })).toBe(true);
    });

    it('hides it on a non-Forever WoW guild, even for a member', () => {
        expect(progressionTabVisible({ page: page('world-of-warcraft-classic') })).toBe(false);
    });

    it('is registered on the WoW hub module as the Progression tab', () => {
        const tab = wowHubModule.tabs?.find((t) => t.id === 'progression');
        expect(tab?.label).toBe('Progression');
        expect(tab?.visible).toBe(progressionTabVisible);
    });
});
