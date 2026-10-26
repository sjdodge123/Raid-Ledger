/**
 * ROK-1955 — the web half of the Companion device link (RFC 8628).
 *
 * Both calls are mutations: preview is a `POST` (the code rides the body so
 * it never lands in an access log) and has no side effect; the decision is
 * only ever sent from an explicit Approve / Deny click.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { CompanionLinkPreviewSchema } from '@raid-ledger/contract';
import type { CompanionLinkDecisionRequest, CompanionLinkPreview } from '@raid-ledger/contract';
import { fetchApi } from '../lib/api/fetch-api';
import { errorBodyOf, httpStatusOf } from '../lib/api/api-error';
import { COMPANION_DEVICES_KEY } from './use-companion-devices';

const LINK_BASE = '/companion/v1/devices/link';

/** `POST /companion/v1/devices/link/decision` response. */
export interface CompanionLinkDecisionResult { status: 'approved' | 'denied' }

/** What went wrong, mapped from the API's status + `code`. */
export type CompanionLinkErrorKind = 'not_found' | 'rate_limited' | 'device_limit' | 'other';

/** Preview a pending link by its (normalised) user code. */
export function previewCompanionLink(userCode: string): Promise<CompanionLinkPreview> {
    const body = JSON.stringify({ userCode });
    return fetchApi(`${LINK_BASE}/preview`, { method: 'POST', body }, CompanionLinkPreviewSchema);
}

/** Approve or deny a pending link. */
export function decideCompanionLink(req: CompanionLinkDecisionRequest): Promise<CompanionLinkDecisionResult> {
    return fetchApi<CompanionLinkDecisionResult>(`${LINK_BASE}/decision`, { method: 'POST', body: JSON.stringify(req) });
}

/** Classify a thrown preview / decision error for the inline copy. */
export function companionLinkErrorKind(error: unknown): CompanionLinkErrorKind {
    const status = httpStatusOf(error);
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status === 409 && errorBodyOf(error)?.code === 'device_limit') return 'device_limit';
    return 'other';
}

/** Mutation: preview a code. No retry — a 404/429 is the answer. */
export function useCompanionLinkPreview(): UseMutationResult<CompanionLinkPreview, Error, string> {
    return useMutation({ mutationFn: previewCompanionLink, retry: false });
}

/** Mutation: the explicit approve / deny decision; an approve refreshes the Devices list. */
export function useCompanionLinkDecision(): UseMutationResult<CompanionLinkDecisionResult, Error, CompanionLinkDecisionRequest> {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: decideCompanionLink,
        retry: false,
        onSuccess: (result) => {
            if (result.status === 'approved') void qc.invalidateQueries({ queryKey: COMPANION_DEVICES_KEY });
        },
    });
}
