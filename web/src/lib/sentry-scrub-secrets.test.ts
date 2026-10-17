/**
 * ROK-1838: secrets must not survive anywhere in an event — not only in the
 * `transaction` / `request` / trace fields the ROK-1366 scrub covered.
 */
import { describe, it, expect } from 'vitest';
import { scrubSecretsFromText } from './sentry-scrub-secrets';
import { scrubPiiBreadcrumb, scrubPiiEvent } from './sentry-scrub-pii';
import { scrubFeedbackPayload } from '../components/feedback/feedback-scrub';

const LINK = 'https://raid.example.test/join?token=abc';

describe('scrubSecretsFromText', () => {
    it('filters each secret query param but keeps the rest of the URL', () => {
        expect(scrubSecretsFromText(LINK)).toBe('https://raid.example.test/join?token=[Filtered]');
        expect(scrubSecretsFromText('/cb?code=xyz&state=s1&next=/events')).toBe(
            '/cb?code=[Filtered]&state=[Filtered]&next=/events',
        );
        expect(scrubSecretsFromText('?access_token=a&refresh_token=b&api_key=c&secret=d&password=e')).toBe(
            '?access_token=[Filtered]&refresh_token=[Filtered]&api_key=[Filtered]&secret=[Filtered]&password=[Filtered]',
        );
    });

    it('filters a bearer token', () => {
        expect(scrubSecretsFromText('Authorization: Bearer eyJhbGciOi.payload.sig')).toBe(
            'Authorization: Bearer [Filtered]',
        );
    });

    it('leaves an unrelated string untouched', () => {
        const plain = 'Signup failed on /events/42 after 3 retries (token-bucket empty)';
        expect(scrubSecretsFromText(plain)).toBe(plain);
    });
});

describe('scrubPiiEvent applies the secret rules at any depth', () => {
    it('scrubs message, exception value, extra and a nested context value', () => {
        const event = scrubPiiEvent({
            message: `broken: ${LINK}`,
            exception: { values: [{ value: `fetch failed for ${LINK}` }] },
            extra: { lastLink: LINK, nested: { deeper: [LINK] } },
            contexts: { feedback: { page: { url: LINK } } },
        });

        expect(event.message).toBe('broken: https://raid.example.test/join?token=[Filtered]');
        expect(event.exception?.values?.[0]?.value).toBe(
            'fetch failed for https://raid.example.test/join?token=[Filtered]',
        );
        expect(JSON.stringify(event.extra)).not.toContain('token=abc');
        expect(JSON.stringify(event.extra)).toContain('token=[Filtered]');
        expect(JSON.stringify(event.contexts)).not.toContain('token=abc');
        expect(JSON.stringify(event.contexts)).toContain('token=[Filtered]');
    });

    it('scrubs a breadcrumb data url', () => {
        const crumb = scrubPiiBreadcrumb({ message: 'nav', data: { url: LINK } });
        expect(crumb.data?.['url']).toBe('https://raid.example.test/join?token=[Filtered]');
    });
});

describe('scrubFeedbackPayload', () => {
    it('scrubs the free text, the page url and the captured console logs', () => {
        const scrubbed = scrubFeedbackPayload({
            category: 'bug',
            message: `Join link ${LINK} is broken`,
            pageUrl: LINK,
            clientLogs: `GET ${LINK} 500`,
        });

        expect(scrubbed.message).toBe('Join link https://raid.example.test/join?token=[Filtered] is broken');
        expect(scrubbed.pageUrl).toBe('https://raid.example.test/join?token=[Filtered]');
        expect(scrubbed.clientLogs).toBe('GET https://raid.example.test/join?token=[Filtered] 500');
        expect(scrubbed.category).toBe('bug');
    });

    it('leaves optional fields absent rather than undefined', () => {
        const scrubbed = scrubFeedbackPayload({ category: 'feature', message: 'nice to have' });
        expect('pageUrl' in scrubbed).toBe(false);
        expect('clientLogs' in scrubbed).toBe(false);
    });
});
