/**
 * ROK-1830 PR-3 r3 — a confirmed dismissal must survive a sibling prompt's
 * response whose body was read BEFORE that dismissal committed.
 *
 * Both prompts share one cache entry. The card's write commits first; the
 * checklist's write was already in flight, so the state it echoes back knows
 * nothing about the card. Before this, the card's pair left the ledger the
 * moment its own write settled, so the stale body silently un-dismissed it.
 */
import { describe, expect, it } from 'vitest';
import type { HubOnboardingStateDto } from '@raid-ledger/contract';
import {
    mergePending, pairId, pendingLedger, type PendingDismissals,
} from './hub-onboarding-pending';

const AT = '2026-10-17T00:00:00.000Z';
const CARD = { key: 'players-get-your-guild', guildId: null, dismissedAt: AT } as const;
const CHECKLIST = { key: 'hub-setup-checklist', guildId: 7, dismissedAt: AT } as const;
const CARD_ID = pairId(CARD.key, CARD.guildId);
const CHECKLIST_ID = pairId(CHECKLIST.key, CHECKLIST.guildId);

describe('hub onboarding pending ledger', () => {
    it('keeps a confirmed dismissal when a sibling answers with a pre-commit body', () => {
        let map: PendingDismissals = {};
        const store = (): PendingDismissals => map;
        const save = (next: PendingDismissals): void => { map = next; };
        const card = pendingLedger(store, save, CARD_ID);
        const checklist = pendingLedger(store, save, CHECKLIST_ID);

        // Both prompts dismissed optimistically, neither write back yet.
        card.begin(false);
        checklist.begin(false);
        let state: HubOnboardingStateDto = { dismissed: [CARD, CHECKLIST] };

        // The card's write commits first and the server echoes just the card.
        const cardBody: HubOnboardingStateDto = { dismissed: [CARD] };
        card.settle('success');
        state = mergePending(cardBody, state, store());
        card.prune(cardBody);

        // The checklist's write answers second, but its read of the server
        // predates the card's commit, so its body omits the card entirely.
        const stale: HubOnboardingStateDto = { dismissed: [CHECKLIST] };
        checklist.settle('success');
        state = mergePending(stale, state, store());
        checklist.prune(stale);

        expect(
            state.dismissed.map((d) => pairId(d.key, d.guildId)).sort(),
            'a stale sibling response must not un-dismiss the confirmed card',
        ).toEqual([CHECKLIST_ID, CARD_ID].sort());
    });

    it('forgets a settled pair once another response reports it', () => {
        let map: PendingDismissals = {};
        const card = pendingLedger(() => map, (next) => { map = next; }, CARD_ID);
        card.begin(false);
        card.settle('success');
        expect(Object.keys(map), 'confirmed pairs are retained').toEqual([CARD_ID]);

        const checklist = pendingLedger(() => map, (next) => { map = next; }, CHECKLIST_ID);
        checklist.begin(false);
        checklist.settle('success');
        checklist.prune({ dismissed: [CARD, CHECKLIST] });
        expect(Object.keys(map), 'a later body carrying the card clears it').toEqual([CHECKLIST_ID]);
    });
});
