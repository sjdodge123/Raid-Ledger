/** ROK-1428 Codex r2 P2 — "Run now" must go ahead for a hub-link-only dry run. */
import { describe, expect, it } from 'vitest';
import type { ReconcileResultDto } from '@raid-ledger/contract';
import { confirmCopy, needsConfirm } from './discord-lifecycle.helpers';

function result(over: Partial<ReconcileResultDto> = {}): ReconcileResultDto {
    return {
        dryRun: true,
        created: 0,
        unarchived: 0,
        archived: 0,
        linkedHubs: 0,
        skipped: 0,
        failed: 0,
        deferred: 0,
        stoppedReason: null,
        items: [],
        ...over,
    };
}

describe('needsConfirm', () => {
    it('confirms a dry run that plans only hub links', () => {
        expect(needsConfirm(result({ linkedHubs: 2 }))).toBe(true);
    });

    it('does not confirm a dry run with nothing to do', () => {
        expect(needsConfirm(result())).toBe(false);
    });

    it('does not confirm a stopped run, even with hub links planned', () => {
        expect(needsConfirm(result({ linkedHubs: 2, stoppedReason: 'disabled' }))).toBe(false);
    });
});

describe('confirmCopy', () => {
    it('names the hub links when any are planned', () => {
        expect(confirmCopy(result({ linkedHubs: 2 }))).toBe(
            'Create 0, archive 0, unarchive 0 channels and link 2 hubs in Discord?',
        );
    });

    it('keeps the channel-only copy when no hubs are linked', () => {
        expect(confirmCopy(result({ created: 2, archived: 1 }))).toBe(
            'Create 2, archive 1, unarchive 0 channels in Discord?',
        );
    });
});
