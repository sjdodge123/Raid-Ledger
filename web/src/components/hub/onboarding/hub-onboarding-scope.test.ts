/**
 * ROK-2153 N4 — the dismissal round (`scope`) in the pure onboarding helpers
 * and the restore route.
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import type { HubOnboardingDismissalDto, HubOnboardingStateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { restoreHubOnboarding } from './hub-onboarding-api';
import { pairId } from './hub-onboarding-pending';
import { isPromptDismissed, withDismissal, withoutDismissal } from './use-hub-onboarding';

const AT = '2026-11-01T00:00:00.000Z';
const UNSCOPED: HubOnboardingDismissalDto = { key: 'claim-character', guildId: 7, dismissedAt: AT };
const ROUND_1: HubOnboardingDismissalDto = { key: 'claim-character', guildId: 7, scope: 'campaign-1', dismissedAt: AT };
const STATE: HubOnboardingStateDto = { dismissed: [UNSCOPED, ROUND_1] };

describe('onboarding dismissal scope', () => {
    it('matches a dismissal only for the same round', () => {
        expect(isPromptDismissed(STATE, 'claim-character', 7, 'campaign-1')).toBe(true);
        expect(isPromptDismissed(STATE, 'claim-character', 7, 'campaign-2')).toBe(false);
        expect(isPromptDismissed({ dismissed: [ROUND_1] }, 'claim-character', 7)).toBe(false);
    });

    it('adds the round to an optimistic row, and an unscoped add writes no scope key', () => {
        const added = withDismissal({ dismissed: [] }, 'claim-character', 7, AT, 'campaign-2');
        expect(added.dismissed).toEqual([{ key: 'claim-character', guildId: 7, scope: 'campaign-2', dismissedAt: AT }]);
        expect(withDismissal({ dismissed: [] }, 'claim-character', 7, AT).dismissed[0]).not.toHaveProperty('scope');
    });

    it('un-dismissing one round leaves the unscoped row and other rounds alone', () => {
        expect(withoutDismissal(STATE, 'claim-character', 7, 'campaign-1').dismissed).toEqual([UNSCOPED]);
    });

    it('keeps one pending pair per round; an unscoped pair keeps its old id', () => {
        expect(pairId('claim-character', 7)).toBe('claim-character:7');
        expect(pairId('claim-character', 7, 'campaign-1')).not.toBe(pairId('claim-character', 7, 'campaign-2'));
    });

    it('restore sends the round on the DELETE, and no scope when there is none', async () => {
        const seen: string[] = [];
        server.use(http.delete('http://localhost:3000/guilds/onboarding/:key/dismiss', ({ request }) => {
            seen.push(new URL(request.url).search);
            return HttpResponse.json({ dismissed: [] });
        }));
        await restoreHubOnboarding('claim-character', 7, 'campaign-1');
        await restoreHubOnboarding('claim-character', 7);
        expect(seen).toEqual(['?guildId=7&scope=campaign-1', '?guildId=7']);
    });
});
