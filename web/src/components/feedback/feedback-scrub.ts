/**
 * ROK-1838: strip URL secrets from a feedback submission before it leaves the
 * browser. The Sentry copy passes through `beforeSend` (and so through the
 * shared scrubbers), but this payload also goes straight to our own API, so a
 * join link pasted into the free-text box — or sat in the address bar, or in
 * the captured console logs — would otherwise be stored verbatim.
 *
 * Secrets only: emails/IPs are deliberately left alone here, because a
 * reporter naming their own account is the point of a bug report.
 *
 * r3: scrubbing runs BEFORE the contract's length caps are enforced and the
 * result is clamped back to them. `[Filtered]` is longer than the secret it
 * replaces, so a message sitting on the 2,000-character limit grew past it and
 * the API rejected the whole submission — including the Sentry copy, which is
 * only sent after the API call succeeds (Codex r3 LOW 3).
 */
import type { CreateFeedbackDto } from '@raid-ledger/contract';
import { scrubSecretsFromText, SECRET_FILTERED } from '../../lib/sentry-scrub-secrets';

export { scrubSecretsFromText };

/**
 * Mirrors `CreateFeedbackSchema` in `packages/contract/src/feedback.schema.ts`
 * (`message.max(2000)`, `clientLogs.max(50_000)`). `feedback-scrub.test.ts`
 * parses a clamped payload through that schema, so a cap change fails here.
 */
export const FEEDBACK_MESSAGE_MAX_CHARS = 2000;
export const FEEDBACK_CLIENT_LOGS_MAX_CHARS = 50_000;

/**
 * Cut at `max`, but never through a `[Filtered]` — r4: a cut that left
 * `…?token=[` behind made the NEXT scrub match `[` as a value and write
 * `[Filtered]` over it, growing the clamped string back past the limit. Cut
 * in front of the partial placeholder instead; the bytes before it are
 * already scrubbed, so nothing secret is uncovered.
 */
function clampOutsidePlaceholder(value: string, max: number): string {
    if (value.length <= max) return value;
    const windowStart = Math.max(0, max - SECRET_FILTERED.length + 1);
    const opened = value.lastIndexOf('[', max - 1);
    if (opened >= windowStart && SECRET_FILTERED.startsWith(value.slice(opened, max))) {
        return value.slice(0, opened);
    }
    return value.slice(0, max);
}

/** Scrub, then clamp — never the other way round. */
function scrubAndClamp(value: string, max: number): string {
    return clampOutsidePlaceholder(scrubSecretsFromText(value), max);
}

/** A copy of the payload with message, pageUrl and clientLogs scrubbed. */
export function scrubFeedbackPayload(payload: CreateFeedbackDto): CreateFeedbackDto {
    const { pageUrl, clientLogs } = payload;
    return {
        ...payload,
        message: scrubAndClamp(payload.message, FEEDBACK_MESSAGE_MAX_CHARS),
        ...(pageUrl === undefined ? {} : { pageUrl: scrubSecretsFromText(pageUrl) }),
        ...(clientLogs === undefined
            ? {}
            : { clientLogs: scrubAndClamp(clientLogs, FEEDBACK_CLIENT_LOGS_MAX_CHARS) }),
    };
}
