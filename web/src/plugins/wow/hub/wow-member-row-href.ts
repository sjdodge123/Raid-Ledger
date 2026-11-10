/** ROK-2149 / ROK-2155 — where a WoW Members row's name link goes (hooks: they read the `/hubs/:id` route). */
import { useParams } from 'react-router-dom';
import type { HubMemberRow } from '../../hub-module';
import { memberPagePath } from '../lib/member-routes';

/**
 * ROK-2149 AC-8 — an unlinked row opens its read-only roster-member page. The hub
 * id comes from the `/hubs/:id` route (cells get only the row; same as `useRowProfessions`).
 */
export function useRosterMemberHref(row: Pick<HubMemberRow, 'characterId' | 'memberId'>): string | undefined {
    const { id } = useParams<{ id: string }>();
    const hubId = Number(id);
    if (row.characterId !== null || !Number.isInteger(hubId) || hubId <= 0) return undefined;
    return memberPagePath(hubId, row.memberId);
}

/**
 * ROK-2155 — the `rowLink` hook: where the row's name link goes (its character
 * page, or the read-only roster page), or `undefined` when the name is plain text.
 */
export function useMemberRowHref(row: Pick<HubMemberRow, 'characterId' | 'memberId'>): string | undefined {
    const rosterHref = useRosterMemberHref(row);
    return row.characterId === null ? rosterHref : `/characters/${row.characterId}`;
}
