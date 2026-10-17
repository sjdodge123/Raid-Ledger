/**
 * ROK-1505 AC9 — the chip sentence and the Discord post title come from ONE
 * formatter.
 *
 * The web half: `lfg-chip-copy.ts` is a re-export shim, so its `groupLine` IS
 * the contract's export (identity, not equality), and the two sentences the
 * operator quoted from the chip are pinned as literals. The api half
 * (`lfg-board-parity.copy.spec.ts`) pins `threadNameFor` to the same literals
 * through the same import — change the string in
 * `packages/contract/src/lfg-copy.ts` and both suites go red.
 *
 * Vitest resolves the BUILT contract: rebuild it (`npm run build -w
 * packages/contract`) before trusting a result here.
 */
import { describe, expect, it } from 'vitest';
import * as contract from '@raid-ledger/contract';
import {
    DEFAULT_VIABILITY_THRESHOLD,
    chipLabel,
    effectiveLfgState,
    groupLine,
    playersStillNeeded,
} from './lfg-chip-copy';

describe('lfg-chip-copy is a shim over the contract formatter (AC9)', () => {
    it('re-exports the contract functions themselves, not copies', () => {
        expect(groupLine).toBe(contract.groupLine);
        expect(playersStillNeeded).toBe(contract.playersStillNeeded);
        expect(effectiveLfgState).toBe(contract.effectiveLfgState);
        expect(DEFAULT_VIABILITY_THRESHOLD).toBe(
            contract.DEFAULT_VIABILITY_THRESHOLD,
        );
    });

    it('reads "1 looking · needs 1 more" at one hand (the LOOKING title)', () => {
        expect(groupLine(1, 'lfg')).toBe('1 looking · needs 1 more');
        expect(groupLine(1, effectiveLfgState(1), null)).toBe(
            '1 looking · needs 1 more',
        );
    });

    it('reads "2 looking to play" once the group has formed', () => {
        expect(groupLine(2, 'lfm')).toBe('2 looking to play');
        expect(groupLine(2, effectiveLfgState(2), 4)).toBe('2 looking to play');
    });

    it('never reads "needs 0 more" — the clamp travels with the sentence', () => {
        expect(playersStillNeeded(1, 1)).toBe(1);
        expect(groupLine(1, 'lfg', 1)).toBe('1 looking · needs 1 more');
    });

    it('the chip badge is the contract sentence behind the 🎯', () => {
        const summary = { activeCount: 1, state: 'lfg' as const, threshold: 4 };
        expect(chipLabel(summary.activeCount, summary.state, summary.threshold)).toBe(
            `🎯 ${contract.groupLine(summary.activeCount, summary.state, summary.threshold)}`,
        );
        expect(chipLabel(1, 'lfg', 4)).toBe('🎯 1 looking · needs 3 more');
    });
});
