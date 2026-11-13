/** ROK-1789 Part B Codex P2 — a LedgerLink import (new kills, joins, dings) refreshes the Progression tab. */
import { describe, expect, it } from 'vitest';
import { invalidateAllHubMemberships } from '../../../components/hub/community/invalidate-hub-membership';
import { createTestQueryClient } from '../../../test/render-helpers';
import { buildProgressionPage } from '../../../test/mocks/guild-progression-handlers';
import { guildProgressionKey } from './use-guild-progression';

describe('guildProgressionKey', () => {
    it('is invalidated by invalidateAllHubMemberships (the addon-import apply hook)', async () => {
        const qc = createTestQueryClient();
        qc.setQueryData(guildProgressionKey(5), buildProgressionPage());
        expect(qc.getQueryState(guildProgressionKey(5))?.isInvalidated).toBe(false);
        await invalidateAllHubMemberships(qc);
        expect(qc.getQueryState(guildProgressionKey(5))?.isInvalidated).toBe(true);
    });

    it('stays distinct from the hub page and its other per-hub queries', () => {
        expect(guildProgressionKey(5)).toEqual(['plugins', 'wow', 'guilds', 5, 'progression']);
    });
});
