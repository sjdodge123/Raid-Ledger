/**
 * ROK-2172 — the role chips' hand-off to the Members filter. The Overview
 * pills link to `#members?role=<role>` (a plain hash link, so `useHashTab`
 * switches tab and a reload of that URL lands on the same filtered list);
 * the WoW filter hook seeds its state from that parameter on mount and writes
 * the parameter back while the filter is exactly one role. `tabFromHash`
 * already ignores everything after `?`, so the tab id stays `members`.
 */
import type { CharacterRole } from '@raid-ledger/contract';
import { ROLE_ORDER } from './wow-guild.helpers';
import { EMPTY_WOW_MEMBER_FILTERS, countActiveWowFilters, type WowMemberFilterState } from './wow-member-filters.helpers';

const MEMBERS_HASH = '#members';

function isCharacterRole(value: string | null): value is CharacterRole {
    return ROLE_ORDER.some((r) => r === value);
}

/** The Overview pill's target: the Members tab filtered to `role`. */
export function roleFilterHref(role: CharacterRole): string {
    return `${MEMBERS_HASH}?role=${role}`;
}

/** `#members?role=tank` → `tank`; another tab, no parameter or an unknown role → null. */
export function roleFromHash(hash: string): CharacterRole | null {
    const [tab, query] = hash.split('?');
    if (tab !== MEMBERS_HASH || query === undefined) return null;
    const role = new URLSearchParams(query).get('role');
    return isCharacterRole(role) ? role : null;
}

/** The filter state a Members mount starts from: exactly the hash's role, else nothing. */
export function filterStateFromHash(hash: string): WowMemberFilterState {
    const role = roleFromHash(hash);
    return role === null ? EMPTY_WOW_MEMBER_FILTERS : { ...EMPTY_WOW_MEMBER_FILTERS, roles: [role] };
}

/** The Members hash for `state`: `#members?role=<r>` while the filter is that one role alone, else `#members`. */
export function membersHashFor(state: WowMemberFilterState): string {
    const only = state.roles.length === 1 && countActiveWowFilters(state) === 1 ? state.roles[0] ?? null : null;
    return isCharacterRole(only) ? roleFilterHref(only) : MEMBERS_HASH;
}

/**
 * Keep the address bar in step with the filter (replace, no history entry and
 * no hashchange). Only touches a Members hash, so a retired alias (`#roster`)
 * is left for `useHashTab` to rewrite.
 */
export function syncMembersHash(state: WowMemberFilterState): void {
    const current = window.location.hash;
    if (current.split('?')[0] !== MEMBERS_HASH) return;
    const next = membersHashFor(state);
    if (next !== current) window.history.replaceState(window.history.state, '', next);
}

/**
 * The state after a `hashchange` / `popstate` while Members is mounted (a
 * Members tab click, Back/Forward, a hand-edited `?role=`): keep `prev` while
 * it already maps to the same Members hash (so a multi-filter state survives
 * a plain `#members`, and our own `replaceState` write never echoes), else
 * re-seed from the hash. Off a Members hash it leaves `prev` alone.
 */
export function followMembersHash(prev: WowMemberFilterState, hash: string): WowMemberFilterState {
    if (hash.split('?')[0] !== MEMBERS_HASH) return prev;
    const next = filterStateFromHash(hash);
    return membersHashFor(next) === membersHashFor(prev) ? prev : next;
}
