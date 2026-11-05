/** ROK-2096 — the Create hub members cap matches the contract (Codex P2). */
import { describe, expect, it } from 'vitest';
import { HUB_CREATE_MEMBERS_MAX } from '@raid-ledger/contract';
import { initialMembers, membersLimitError } from './hubs-create-form';

describe('hubs-create-form', () => {
    it('drops the leader from the picked members', () => {
        expect(initialMembers([3, 9, 4], 9)).toEqual([3, 4]);
        expect(initialMembers([3, 4], null)).toEqual([3, 4]);
    });

    it('flags a selection over the contract cap and allows the cap itself', () => {
        expect(membersLimitError(HUB_CREATE_MEMBERS_MAX)).toBeNull();
        expect(membersLimitError(HUB_CREATE_MEMBERS_MAX + 1)).toMatch(new RegExp(`at most ${HUB_CREATE_MEMBERS_MAX}`));
    });
});
