/**
 * ROK-2153 S3b — the core claim prompt's copy. Generic defaults (spec N1
 * recommendation, vetoable on the PR) with a per-provider `copy` override for
 * the heading, body, phone body and the list-opening button.
 */
import { errorBodyOf, httpStatusOf } from '../../../lib/api/api-error';
import type { HubClaimCopy } from './hub-claim-providers';

export interface ResolvedHubClaimCopy {
    readonly heading: string;
    readonly body: string;
    readonly shortBody: string;
    /** Opens the candidate list. */
    readonly cta: string;
}

export const HUB_CLAIM_DEFAULT_COPY: ResolvedHubClaimCopy = {
    heading: 'Claim your character',
    body: 'Is one of the characters on this hub yours? Claim it so it shows on your profile and the hub knows it is you.',
    shortBody: 'Is one of the characters here yours? Claim it.',
    cta: 'Pick my character',
};

/** Fixed strings the provider cannot override. */
export const HUB_CLAIM_TEXT = {
    landmark: 'Claim your character',
    suggestedLead: 'Is this you?',
    claimNamed: (name: string): string => `Claim ${name}`,
    notMe: 'Not me? Pick another',
    dismiss: "Dismiss: don't show this again",
    dismissed: "Got it. We won't show this again.",
    dismissFailed: "We couldn't dismiss that just now. Try again in a moment.",
    listTitle: 'Pick your character',
    rowClaim: 'Claim',
    truncated: (shown: number, total: number): string => `Showing ${shown} of ${total} characters.`,
    empty: 'There are no characters left to claim on this hub.',
} as const;

/** Provider overrides first, then the defaults; a missing `shortBody` falls back to the resolved body. */
export function resolveHubClaimCopy(copy: HubClaimCopy | undefined): ResolvedHubClaimCopy {
    const body = copy?.body ?? HUB_CLAIM_DEFAULT_COPY.body;
    return {
        heading: copy?.heading ?? HUB_CLAIM_DEFAULT_COPY.heading,
        body,
        shortBody: copy?.shortBody ?? (copy?.body === undefined ? HUB_CLAIM_DEFAULT_COPY.shortBody : body),
        cta: copy?.cta ?? HUB_CLAIM_DEFAULT_COPY.cta,
    };
}

export type HubClaimErrorTone = 'warning' | 'danger';

export interface HubClaimErrorView {
    readonly tone: HubClaimErrorTone;
    readonly message: string;
    /** The list is stale: refetch the status. */
    readonly refresh: boolean;
}

const ERROR_COPY: Readonly<Record<string, HubClaimErrorView>> = {
    HUB_CLAIM_CANDIDATE_TAKEN: { tone: 'warning', message: 'Someone else just claimed that character. Pick another.', refresh: true },
    HUB_CLAIM_CANDIDATE_GONE: { tone: 'warning', message: 'That character is no longer on this hub. Pick another.', refresh: true },
    HUB_CLAIM_VIEWER_HAS_CLAIM: { tone: 'warning', message: 'You already have a character on this hub.', refresh: true },
};

const GENERIC_ERROR: HubClaimErrorView = { tone: 'danger', message: "We couldn't claim that character. Try again in a moment.", refresh: false };

/** Inline banner copy for a failed claim (AC 4: a banner, never a toast). */
export function hubClaimErrorView(error: unknown): HubClaimErrorView {
    const code = errorBodyOf(error)?.['code'];
    const known = typeof code === 'string' ? ERROR_COPY[code] : undefined;
    if (known !== undefined) return known;
    if (httpStatusOf(error) === 409) return { ...GENERIC_ERROR, tone: 'warning', refresh: true };
    return GENERIC_ERROR;
}
