/**
 * ROK-1838: strip URL secrets from a feedback submission before it leaves the
 * browser. The Sentry copy passes through `beforeSend` (and so through the
 * shared scrubbers), but this payload also goes straight to our own API, so a
 * join link pasted into the free-text box — or sat in the address bar, or in
 * the captured console logs — would otherwise be stored verbatim.
 *
 * Secrets only: emails/IPs are deliberately left alone here, because a
 * reporter naming their own account is the point of a bug report.
 */
import type { CreateFeedbackDto } from '@raid-ledger/contract';
import { scrubSecretsFromText } from '../../lib/sentry-scrub-secrets';

export { scrubSecretsFromText };

/** A copy of the payload with message, pageUrl and clientLogs scrubbed. */
export function scrubFeedbackPayload(payload: CreateFeedbackDto): CreateFeedbackDto {
    const { pageUrl, clientLogs } = payload;
    return {
        ...payload,
        message: scrubSecretsFromText(payload.message),
        ...(pageUrl === undefined ? {} : { pageUrl: scrubSecretsFromText(pageUrl) }),
        ...(clientLogs === undefined ? {} : { clientLogs: scrubSecretsFromText(clientLogs) }),
    };
}
