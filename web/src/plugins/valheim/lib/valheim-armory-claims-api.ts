/**
 * ROK-1836 L4 — Valheim armory claim + admin-owner client (ROK-1835 routes):
 * member claim, admin owner assign/unassign, and the claim audit trail.
 */
import {
    ValheimClaimEventListResponseSchema,
    type ValheimAssignOwnerBody,
    type ValheimClaimEvent,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api/fetch-api';
import { encodePathSegment } from '../../../lib/api/path-segment';
import { VALHEIM_ARMORY_PATH, valheimArmoryKeys } from './valheim-armory-api';

const ADMIN_PATH = `/admin${VALHEIM_ARMORY_PATH}/characters`;
const seg = (id: number) => encodePathSegment(String(id));

export const valheimClaimKeys = {
    events: (id: number) => [...valheimArmoryKeys.all, 'claim-events', id] as const,
};

/** `POST …/characters/:id/claim` — 409 when someone already owns it. */
export async function claimValheimCharacter(id: number): Promise<void> {
    await fetchApi(`${VALHEIM_ARMORY_PATH}/characters/${seg(id)}/claim`, { method: 'POST' });
}

/** `PUT /admin/…/characters/:id/owner` — `userId: null` removes the owner. */
export async function assignValheimOwner(id: number, body: ValheimAssignOwnerBody): Promise<void> {
    await fetchApi(`${ADMIN_PATH}/${seg(id)}/owner`, { method: 'PUT', body: JSON.stringify(body) });
}

/** `GET /admin/…/characters/:id/claim-events` — newest first. */
export async function fetchValheimClaimEvents(id: number): Promise<ValheimClaimEvent[]> {
    const res = await fetchApi(`${ADMIN_PATH}/${seg(id)}/claim-events`, {}, ValheimClaimEventListResponseSchema);
    return res.data;
}

/** True when a mutation error is the API's 409 (claimed by someone else first). */
export function isConflictError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'status' in error && error.status === 409;
}
