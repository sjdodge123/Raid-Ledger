/** ROK-2096 — pure helpers behind the Create hub form's initial members. */
import { HUB_CREATE_MEMBERS_MAX } from '@raid-ledger/contract';

/** The members to send: the picks minus the leader (the server ignores it too). */
export function initialMembers(picked: readonly number[], leaderId: number | null): number[] {
    return picked.filter((id) => id !== leaderId);
}

/** The inline error when the picks exceed the contract's cap, else null. */
export function membersLimitError(count: number): string | null {
    return count > HUB_CREATE_MEMBERS_MAX ? `Pick at most ${HUB_CREATE_MEMBERS_MAX} members — you have ${count}.` : null;
}
