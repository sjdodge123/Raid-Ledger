/**
 * ROK-1893 P3 — who may start a poll from a hub's Events tab.
 */
import type { User } from '../../../hooks/use-auth';
import { isOperatorOrAdmin } from '../../../hooks/use-auth';

/** A joined member or staff (operator/admin) — the same rule the API enforces. */
export function canCreateHubPoll(viewerJoined: boolean, user: User | null | undefined): boolean {
    return viewerJoined || isOperatorOrAdmin(user);
}
