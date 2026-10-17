/**
 * ROK-1838: secrets must not survive anywhere in an event — not only in the
 * `transaction` / `request` / trace fields the ROK-1366 scrub covered.
 */
import { describe, it, expect } from 'vitest';
import { scrubSecretsFromText } from './sentry-scrub-secrets';
import { scrubPiiBreadcrumb, scrubPiiEvent } from './sentry-scrub-pii';
import { CreateFeedbackSchema } from '@raid-ledger/contract';
import {
    FEEDBACK_CLIENT_LOGS_MAX_CHARS,
    FEEDBACK_MESSAGE_MAX_CHARS,
    scrubFeedbackPayload,
} from '../components/feedback/feedback-scrub';

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

/**
 * ROK-1838 r3 (Codex): the value must stop at JSON/log structure, a bare
 * `key=value` must match with no URL delimiter, a one-character Bearer token
 * counts, and `code`/`state` must NOT fire in source-like text.
 */
describe('scrubSecretsFromText — before/after table (r3)', () => {
    it.each([
        // JSON log line: only the token goes, `status` survives (MEDIUM 1).
        ['{"url":"/join?token=abc","status":500}', '{"url":"/join?token=[Filtered]","status":500}'],
        // URL in a query string.
        ['https://rl.test/cb?code=xyz&next=/events', 'https://rl.test/cb?code=[Filtered]&next=/events'],
        // Bearer header, one character (r3: no 8-char floor).
        ['Authorization: Bearer x', 'Authorization: Bearer [Filtered]'],
        // Bare `key=value`, no `?`/`&`/`#` in front.
        ['password=swordfish', 'password=[Filtered]'],
        // JSON object form.
        ['{"access_token":"abc"}', '{"access_token":"[Filtered]"}'],
        // Quoted JSON ambiguous key still fires.
        ['{"code":"xyz","ok":true}', '{"code":"[Filtered]","ok":true}'],
    ])('scrubs %j', (input: string, expected: string) => {
        expect(scrubSecretsFromText(input)).toBe(expected);
    });

    it.each([
        // LOW 2: source-like text, not a URL — must be byte-identical.
        'ready?state=nextState:previousState;dispatch(state)',
        // A plain diagnostic line that merely contains the word `token`.
        'Signup failed on /events/42 after 3 retries (token-bucket empty)',
        // A JSON line with no secret key at all.
        '{"status":500,"route":"/events","retries":3}',
    ])('leaves %j byte-identical', (input: string) => {
        expect(scrubSecretsFromText(input)).toBe(input);
    });
});

describe('scrubPiiEvent — r3 coverage gaps', () => {
    it('scrubs stack frames, mechanism data, logentry and threads', () => {
        // Held in variables, not inline literals: excess-property checking
        // would otherwise reject the real SDK shape against the narrow
        // `{ value?: string }` the helper declares.
        const frame = {
            filename: LINK,
            abs_path: LINK,
            context_line: `fetch("${LINK}")`,
            pre_context: [LINK],
            post_context: [LINK],
            vars: { joinUrl: LINK },
        };
        const exceptionValue = {
            value: 'boom',
            mechanism: { data: { url: LINK } },
            stacktrace: { frames: [frame] },
        };
        const event = scrubPiiEvent({
            exception: { values: [exceptionValue] },
            logentry: { message: 'broke %s', params: [LINK] },
            threads: { values: [{ stacktrace: { frames: [frame] } }] },
        });

        const serialized = JSON.stringify(event);
        expect(serialized).not.toContain('token=abc');
        expect(serialized).toContain('token=[Filtered]');
    });

    it('drops a secret-named key whatever shape its value has', () => {
        const event = scrubPiiEvent({
            extra: { password: 'swordfish', access_token: 'abc', nested: { apiKey: { a: 1 } } },
            request: { headers: { cookie: 'sid=1', Authorization: 'Bearer abc' } },
        });

        expect(event.extra).toEqual({
            password: '[Filtered]',
            access_token: '[Filtered]',
            nested: { apiKey: '[Filtered]' },
        });
        expect(JSON.stringify(event.request)).not.toContain('sid=1');
        expect(JSON.stringify(event.request)).not.toContain('Bearer abc');
    });

    it('secret-scrubs a version-keyed string while keeping a real version', () => {
        const event = scrubPiiEvent({
            extra: { appVersion: '/join?token=abc' },
            contexts: { browser: { name: 'Chrome', version: '141.0.0.0' } },
        });

        expect(event.extra).toEqual({ appVersion: '/join?token=[Filtered]' });
        expect(event.contexts).toEqual({ browser: { name: 'Chrome', version: '141.0.0.0' } });
    });

    it("carries an Error's non-enumerable cause into the scrubbed copy", () => {
        const err = new Error('outer', { cause: new Error(`inner ${LINK}`) });
        const event = scrubPiiEvent({ extra: { err } });
        const serialized = JSON.stringify(event.extra);

        expect(serialized).not.toContain('token=abc');
        expect(serialized).toContain('token=[Filtered]');
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

    it('clamps to the contract limit AFTER scrubbing so the API still accepts it', () => {
        // Exactly 2,000 chars pre-scrub; `[Filtered]` is 9 chars longer than `x`.
        const message = `${'a'.repeat(1992)}?token=x`;
        expect(message).toHaveLength(FEEDBACK_MESSAGE_MAX_CHARS);

        const scrubbed = scrubFeedbackPayload({ category: 'bug', message });

        expect(scrubbed.message).not.toContain('?token=x');
        expect(scrubbed.message.length).toBe(FEEDBACK_MESSAGE_MAX_CHARS);
        expect(CreateFeedbackSchema.safeParse(scrubbed).success).toBe(true);
    });

    it('clamps scrubbed client logs to the contract limit', () => {
        const clientLogs = `${'b'.repeat(49_992)}?token=x`;
        const scrubbed = scrubFeedbackPayload({ category: 'bug', message: 'ten chars.', clientLogs });

        expect(scrubbed.clientLogs?.length).toBe(FEEDBACK_CLIENT_LOGS_MAX_CHARS);
        expect(CreateFeedbackSchema.safeParse(scrubbed).success).toBe(true);
    });

    it('leaves optional fields absent rather than undefined', () => {
        const scrubbed = scrubFeedbackPayload({ category: 'feature', message: 'nice to have' });
        expect('pageUrl' in scrubbed).toBe(false);
        expect('clientLogs' in scrubbed).toBe(false);
    });
});
