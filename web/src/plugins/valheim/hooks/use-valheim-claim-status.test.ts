import { describe, expect, it } from 'vitest';
import { valheimArmoryKeys } from '../lib/valheim-armory-api';
import { claimStatusQueryKey } from './use-valheim-claim-status';

describe('claimStatusQueryKey', () => {
    it('matches valheimArmoryKeys.claimStatus, so armory invalidations refresh the banner', () => {
        expect(claimStatusQueryKey(7)).toEqual(valheimArmoryKeys.claimStatus(7));
    });

    it('sits under valheimArmoryKeys.all, so an `all` invalidation reaches it', () => {
        expect(claimStatusQueryKey(7).slice(0, valheimArmoryKeys.all.length)).toEqual([...valheimArmoryKeys.all]);
    });
});
