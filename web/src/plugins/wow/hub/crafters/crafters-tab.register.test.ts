/**
 * ROK-1790 — `craftersTabVisible` reads the roster-insights cache outside
 * React. Its key must use the same viewer scope as `useRosterInsights`
 * (the `['auth', 'me']` user), not the localStorage user copy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import { queryClient } from '../../../../lib/query-client';
import { USER_CACHE_KEY } from '../../../../lib/api/auth-storage-keys';
import { rosterInsightsKey } from '../../hub-widgets/use-roster-insights';
import { NO_PROFESSIONS_FIXTURE, PROFESSIONS_FIXTURE } from '../../../../test/handlers/forever-hub-widgets';
import { craftersTabVisible } from './crafters-tab.register';

const GUILD_ID = 7;
const VIEWER_ID = 1;

function page(role: GuildPage['viewer']['role']): GuildPage {
    return {
        guild: { id: GUILD_ID, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null,
            faction: null, memberCount: 5, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(['auth', 'me'], { id: VIEWER_ID, role: 'member' });
    // A stale localStorage user with another id must not steer the key.
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ id: 99 }));
});

afterEach(() => {
    queryClient.clear();
    localStorage.clear();
});

describe('craftersTabVisible', () => {
    it('is visible to a member while the roster-insights query is still loading', () => {
        expect(craftersTabVisible({ page: page('member') })).toBe(true);
    });

    it('is visible once the cached payload has profession data', () => {
        queryClient.setQueryData(rosterInsightsKey(GUILD_ID, false, VIEWER_ID), PROFESSIONS_FIXTURE);
        expect(craftersTabVisible({ page: page('member') })).toBe(true);
    });

    it('hides once the payload cached under the hook’s viewer scope has no professions', () => {
        queryClient.setQueryData(rosterInsightsKey(GUILD_ID, false, VIEWER_ID), NO_PROFESSIONS_FIXTURE);
        expect(craftersTabVisible({ page: page('member') })).toBe(false);
    });

    it('stays hidden from a non-staff visitor even before the query lands', () => {
        expect(craftersTabVisible({ page: page('visitor') })).toBe(false);
    });
});
