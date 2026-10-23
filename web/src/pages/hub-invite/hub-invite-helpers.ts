/** ROK-1893 P1 — pure helpers for the `/h/:token` landing. */
import { HubInviteStateSchema } from '@raid-ledger/contract';
import { errorBodyOf, httpStatusOf } from '../../lib/api/api-error';
import type { DeadReason } from './hub-invite-cards';

export const hubInvitePath = (token: string): string => `/h/${encodeURIComponent(token)}`;
export const hubPath = (hubId: number): string => `/guilds/${hubId}`;

/** 404 → unknown/unavailable link; 410 → the `state` in the body (L2: join's expired/revoked/exhausted). */
export function deadReasonFromError(err: unknown): DeadReason | null {
    const status = httpStatusOf(err);
    if (status === 404) return 'invalid';
    if (status !== 410) return null;
    const parsed = HubInviteStateSchema.safeParse(errorBodyOf(err)?.['state']);
    return parsed.success && parsed.data !== 'ok' ? parsed.data : 'expired';
}

