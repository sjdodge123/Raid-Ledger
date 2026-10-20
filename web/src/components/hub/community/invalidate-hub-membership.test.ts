/** ROK-1870 — one membership change refreshes every surface that shows it. */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { guildPageKey } from '../api/use-guild';
import { invalidateHubMembership } from './invalidate-hub-membership';

const KEYS: readonly (readonly unknown[])[] = [
    ['plugins', 'wow', 'guilds', 'mine', 'viewer-7'],
    guildPageKey(41),
    ['game-hubs', 9],
    ['hubs-directory', { membership: 'all', sort: 'members' }],
    ['hubs-directory', { membership: 'not-joined', sort: 'name' }],
];

describe('invalidateHubMembership', () => {
    it('invalidates the nav hubs, the hub page, every game card and every directory listing', async () => {
        const qc = new QueryClient();
        for (const key of KEYS) qc.setQueryData(key, { seeded: true });
        qc.setQueryData(guildPageKey(42), { seeded: true });
        await invalidateHubMembership(qc, 41);
        for (const key of KEYS) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
        expect(qc.getQueryState(guildPageKey(42))?.isInvalidated, 'another hub page is untouched').toBe(false);
    });
});
