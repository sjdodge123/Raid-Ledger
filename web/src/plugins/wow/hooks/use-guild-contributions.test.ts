/** ROK-2148 Codex P2 — an addon import (which can change a guild's givers) refreshes the contributions card. */
import { describe, expect, it } from 'vitest';
import { invalidateAllHubMemberships } from '../../../components/hub/community/invalidate-hub-membership';
import { createTestQueryClient } from '../../../test/render-helpers';
import { buildEmptyContributions } from '../../../test/mocks/guild-contributions-handlers';
import { guildContributionsKey } from './use-guild-contributions';

describe('guildContributionsKey', () => {
    it('is invalidated by invalidateAllHubMemberships (the addon-import apply hook)', async () => {
        const qc = createTestQueryClient();
        qc.setQueryData(guildContributionsKey(5), buildEmptyContributions());
        expect(qc.getQueryState(guildContributionsKey(5))?.isInvalidated).toBe(false);
        await invalidateAllHubMemberships(qc);
        expect(qc.getQueryState(guildContributionsKey(5))?.isInvalidated).toBe(true);
    });
});
