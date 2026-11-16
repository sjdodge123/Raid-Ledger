/**
 * ROK-2216 U7 — the Dungeon planner tab shows on every WoW: Forever GUILD hub
 * (members, staff and visitors who can see it — ROK-2207 OQ8) and never on a
 * Forever `game_community` hub (ROK-2214 Q2: the plan API serves guild hubs only).
 */
import { describe, it, expect } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import { dungeonPlannerTab, dungeonPlannerTabVisible } from './dungeon-planner-tab.register';

function page(kind: GuildPage['guild']['kind'], gameSlug: string, role: GuildPage['viewer']['role']): GuildPage {
    return {
        guild: { id: 7, gameId: 3, kind, name: 'Hub', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 5, lastSnapshotAt: null, gameSlug },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

const FOREVER = 'world-of-warcraft-forever';

describe('dungeonPlannerTabVisible', () => {
    it('shows on a Forever guild hub to a visitor', () => {
        expect(dungeonPlannerTabVisible({ page: page('wow_guild', FOREVER, 'visitor') })).toBe(true);
    });

    it('shows on a Forever guild hub to a member', () => {
        expect(dungeonPlannerTabVisible({ page: page('wow_guild', FOREVER, 'member') })).toBe(true);
    });

    it('hides on a Forever game_community hub', () => {
        expect(dungeonPlannerTabVisible({ page: page('game_community', FOREVER, 'member') })).toBe(false);
    });

    it('hides on a non-Forever WoW guild hub', () => {
        expect(dungeonPlannerTabVisible({ page: page('wow_guild', 'world-of-warcraft-classic', 'member') })).toBe(false);
    });
});

describe('dungeonPlannerTab', () => {
    it('is the dungeon-planner tab between Raids (10) and Crafters (15)', () => {
        expect(dungeonPlannerTab).toMatchObject({ id: 'dungeon-planner', label: 'Dungeon planner', order: 12 });
    });
});
