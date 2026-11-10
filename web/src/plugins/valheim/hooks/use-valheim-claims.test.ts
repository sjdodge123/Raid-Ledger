import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { hubClaimKey } from '../../../components/hub/claim/use-hub-claim';
import { guildPageKey } from '../../../components/hub/api/use-guild';
import { invalidateOwnership } from './use-valheim-claims';

/**
 * Codex P2 (ROK-2153 S4): a claim or owner change made on the armory sheet /
 * Characters tab must also refresh the core hub claim status, or the Overview
 * prompt keeps offering a character that is already claimed.
 */
describe('invalidateOwnership', () => {
    it("invalidates every hub's core claim status, and leaves the hub page alone", async () => {
        const qc = new QueryClient();
        const claimA = [...hubClaimKey(3), 'viewer:42'];
        const claimB = [...hubClaimKey(9), 'viewer:42'];
        const page = [...guildPageKey(3), 'viewer:42'];
        for (const key of [claimA, claimB, page]) qc.setQueryData(key, { seeded: true });

        await invalidateOwnership(qc, 1);

        expect(qc.getQueryState(claimA)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(claimB)?.isInvalidated).toBe(true);
        expect(qc.getQueryState(page)?.isInvalidated).toBe(false);
    });
});
