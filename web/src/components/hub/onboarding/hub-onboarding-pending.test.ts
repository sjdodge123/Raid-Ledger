/**
 * ROK-1830 PR-3 r4 — a confirmed dismissal is retired by a confirmed restore
 * and by nothing else.
 *
 * Every prompt shares one cache entry and the writes answer out of order, so
 * a response body only knows the rows the server held when it was READ. The
 * races below all turn on that: a body that predates a sibling's commit must
 * never un-dismiss it, however many later bodies have already carried it.
 */
import { describe, expect, it } from 'vitest';
import type { HubOnboardingStateDto } from '@raid-ledger/contract';
import {
    mergePending, pairId, pendingLedger, type PendingDismissals,
} from './hub-onboarding-pending';

const AT = '2026-10-17T00:00:00.000Z';
const CARD = { key: 'players-get-your-guild', guildId: null, dismissedAt: AT } as const;
const CHECKLIST = { key: 'hub-setup-checklist', guildId: 7, dismissedAt: AT } as const;
const OTHER = { key: 'hub-setup-checklist', guildId: 9, dismissedAt: AT } as const;
const CARD_ID = pairId(CARD.key, CARD.guildId);
const CHECKLIST_ID = pairId(CHECKLIST.key, CHECKLIST.guildId);
const OTHER_ID = pairId(OTHER.key, OTHER.guildId);

function ledgerStore(): { read: () => PendingDismissals; write: (next: PendingDismissals) => void } {
    let map: PendingDismissals = {};
    return { read: () => map, write: (next) => { map = next; } };
}

function ids(state: HubOnboardingStateDto): string[] {
    return state.dismissed.map((d) => pairId(d.key, d.guildId)).sort();
}

describe('hub onboarding pending ledger', () => {
    it('keeps a confirmed dismissal when a sibling answers with a pre-commit body', () => {
        const store = ledgerStore();
        const card = pendingLedger(store.read, store.write, CARD_ID);
        const checklist = pendingLedger(store.read, store.write, CHECKLIST_ID);

        // Both prompts dismissed optimistically, neither write back yet.
        card.begin(false);
        checklist.begin(false);
        let state: HubOnboardingStateDto = { dismissed: [CARD, CHECKLIST] };

        // The card's write commits first and the server echoes just the card.
        card.settle('success');
        state = mergePending({ dismissed: [CARD] }, state, store.read());

        // The checklist's write answers second, but its read of the server
        // predates the card's commit, so its body omits the card entirely.
        checklist.settle('success');
        state = mergePending({ dismissed: [CHECKLIST] }, state, store.read());

        expect(
            ids(state),
            'a stale sibling response must not un-dismiss the confirmed card',
        ).toEqual([CARD_ID, CHECKLIST_ID].sort());
    });

    it('survives a third response whose body is older than the one before it', () => {
        // Codex P2 r4: A confirms; B's body carries A; C's body predates both.
        const store = ledgerStore();
        const a = pendingLedger(store.read, store.write, CARD_ID);
        const b = pendingLedger(store.read, store.write, CHECKLIST_ID);
        const c = pendingLedger(store.read, store.write, OTHER_ID);
        a.begin(false);
        b.begin(false);
        c.begin(false);
        let state: HubOnboardingStateDto = { dismissed: [CARD, CHECKLIST, OTHER] };

        a.settle('success');
        state = mergePending({ dismissed: [CARD, OTHER] }, state, store.read());
        b.settle('success');
        state = mergePending({ dismissed: [CARD, CHECKLIST, OTHER] }, state, store.read());
        // C's request was read before A ever committed.
        c.settle('success');
        state = mergePending({ dismissed: [OTHER] }, state, store.read());

        expect(
            ids(state),
            "a later body carrying A must not let C's older body un-dismiss it",
        ).toEqual([CARD_ID, CHECKLIST_ID, OTHER_ID].sort());
    });

});

describe('hub onboarding pending ledger — rollback', () => {
    it('retires a confirmed dismissal only when a restore succeeds', () => {
        const store = ledgerStore();
        const card = pendingLedger(store.read, store.write, CARD_ID);
        card.begin(false);
        card.settle('success');
        expect(Object.keys(store.read()), 'a confirmed pair is retained').toEqual([CARD_ID]);

        // A failed restore leaves the confirmation — and so the row — standing.
        card.beginRestore();
        expect(
            ids(mergePending({ dismissed: [] }, { dismissed: [CARD] }, store.read())),
            'the row hides while its restore is in flight',
        ).toEqual([]);
        expect(card.settleRestore('error'), 'a failed restore rolls its own row back').toBe(true);
        expect(
            ids(mergePending({ dismissed: [] }, { dismissed: [CARD] }, store.read())),
            'a failed restore leaves the dismissal confirmed',
        ).toEqual([CARD_ID]);

        // A confirmed restore is the one thing that clears it.
        card.beginRestore();
        expect(card.settleRestore('success'), 'a confirmed restore needs no rollback').toBe(false);
        expect(Object.keys(store.read()), 'a confirmed restore forgets the pair').toEqual([]);
        expect(
            ids(mergePending({ dismissed: [] }, { dismissed: [CARD] }, store.read())),
            'the prompt is back once the restore is confirmed',
        ).toEqual([]);
    });

    it('rolls back only the failing pair, never a sibling that confirmed', () => {
        const store = ledgerStore();
        const card = pendingLedger(store.read, store.write, CARD_ID);
        const checklist = pendingLedger(store.read, store.write, CHECKLIST_ID);
        card.begin(false);
        checklist.begin(false);
        card.settle('success');

        expect(checklist.settle('error'), 'the failing write rolls itself back').toBe(true);
        expect(
            ids(mergePending({ dismissed: [] }, { dismissed: [CARD] }, store.read())),
            "a sibling's failure must not drop the confirmed card",
        ).toEqual([CARD_ID]);
    });

    it('does not roll back a pair a second write already confirmed', () => {
        const store = ledgerStore();
        const card = pendingLedger(store.read, store.write, CARD_ID);
        card.begin(false);
        card.begin(true);
        card.settle('success');
        expect(card.settle('error'), 'a confirmed pair is never rolled back').toBe(false);
    });
});
