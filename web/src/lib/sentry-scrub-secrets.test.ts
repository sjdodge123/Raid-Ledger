/**
 * ROK-1838: secrets must not survive anywhere in an event — not only in the
 * `transaction` / `request` / trace fields the ROK-1366 scrub covered.
 */
import { describe, it, expect } from 'vitest';
import { isSecretKey, scrubSecretsFromText } from './sentry-scrub-secrets';
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
 * ROK-1838 r4: the rules were redesigned rather than patched a fourth time,
 * and this table IS the specification. Every row is checked twice — once for
 * the expected output and once for `scrub(scrub(x)) === scrub(x)`, because
 * every r1–r3 regression was an overlapping second pass.
 */
describe('scrubSecretsFromText — rule table (r4)', () => {
    it.each([
        // --- 2a: query/fragment params, inside something that is a URL.
        ['https://raid.example.test/join?token=abc', 'https://raid.example.test/join?token=[Filtered]'],
        ['https://rl.test/cb?code=xyz&next=/events', 'https://rl.test/cb?code=[Filtered]&next=/events'],
        ['/cb?code=xyz&state=s1&next=/events', '/cb?code=[Filtered]&state=[Filtered]&next=/events'],
        // A comma ends a value: no credential format contains one, so `,def`
        // belongs to the log line, not to the token.
        ['/join?token=abc,def', '/join?token=[Filtered],def'],
        // No length cap: a 5,000-character token goes whole, and the tail stays.
        [`/j?token=${'a'.repeat(5000)} tail`, '/j?token=[Filtered] tail'],
        // ...and a long path does not hide the param that follows it.
        [`/${'a'.repeat(3000)}?code=TAIL`, `/${'a'.repeat(3000)}?code=[Filtered]`],
        // --- 3: path tokens (ROK-1366/1750 + the r4 ICS feed).
        ['https://a.test/api/cal/u/AAAAAAAAAAAAAAAAAAAA.ics', 'https://a.test/api/cal/u/[Filtered].ics'],
        ['/p/poll/AAAAAAAAAAAAAAAAAAAA', '/p/poll/[Filtered]'],
        // --- 2b: `key=value` / `key: value` / `"key":"value"` anywhere.
        ['password=swordfish', 'password=[Filtered]'],
        // Whitespace after `=` is consumed, so a second pass sees what the
        // first one wrote.
        ['password= x', 'password=[Filtered]'],
        // A spoofed or partial placeholder with secret bytes glued on goes whole.
        ['password=[Filtered]swordfish', 'password=[Filtered]'],
        ['{"access_token":"abc"}', '{"access_token":"[Filtered]"}'],
        // A quoted value runs to its closing quote, so the JSON stays valid.
        ['{"password": "hunter 2"}', '{"password":"[Filtered]"}'],
        ['clientSecret: abc123', 'clientSecret:[Filtered]'],
        ['Set-Cookie: sid=1; Path=/', 'Set-Cookie:[Filtered] Path=/'],
        // A JSON log line: the secret goes, `status` survives.
        ['{"url":"/join?token=abc","status":500}', '{"url":"/join?token=[Filtered]","status":500}'],
        ['?access_token=a&refresh_token=b&api_key=c&secret=d&password=e',
            '?access_token=[Filtered]&refresh_token=[Filtered]&api_key=[Filtered]&secret=[Filtered]&password=[Filtered]'],
        // --- 2c: Bearer, any run of whitespace, any length >= 1.
        ['Authorization: Bearer eyJhbGciOi.payload.sig', 'Authorization: Bearer [Filtered]'],
        ['Authorization: Bearer x', 'Authorization: Bearer [Filtered]'],
        ['Bearer          x', 'Bearer          [Filtered]'],
        // --- r5 P1: a non-secret key must not consume the secret behind it.
        // `Error` used to match the old generic `key[=:]value` shape, test
        // innocent, and leave the scan positioned past `password=swordfish`.
        ['Error: password=swordfish', 'Error: password=[Filtered]'],
        ['status: ok, token=abc', 'status: ok, token=[Filtered]'],
        ['TypeError: cannot read secret=hunter2', 'TypeError: cannot read secret=[Filtered]'],
        // --- r5 P1: the auth scheme matches in any case. Lowercase `bearer`
        // used to be scrubbed AS the value, shipping the JWT behind it.
        ['Authorization: bearer eyJhbGciOi.payload.sig', 'Authorization: bearer [Filtered]'],
        ['authorization: BASIC dXNlcjpwYXNz', 'authorization: BASIC [Filtered]'],
        // --- r5 P2: the explicit `*_key` compounds are still credentials.
        ['apiKey=x', 'apiKey=[Filtered]'],
        ['{"signingKey":"abc"}', '{"signingKey":"[Filtered]"}'],
    ])('scrubs %j', (input: string, expected: string) => {
        expect(scrubSecretsFromText(input)).toBe(expected);
        expect(scrubSecretsFromText(expected)).toBe(expected);
    });

    it.each([
        // Source-like text, not a URL — the `/` is division, not a path.
        'ready?state=nextState:previousState;dispatch(state)',
        'a/b?state=next:prev',
        // A plain diagnostic line that merely contains the word `token`.
        'Signup failed on /events/42 after 3 retries (token-bucket empty)',
        '{"status":500,"route":"/events","retries":3}',
        // r4: `code`/`state`/`key` are credentials only as URL params — here
        // they are an HTTP status, a UI state and a keyboard key.
        '{"code":500,"state":"idle","key":"ArrowUp"}',
        // Substring matching used to drop all four of these.
        '{"tokenCount":5,"tokenizer":"bpe","passwordPolicy":"strong","keyboard":"qwerty"}',
        // r5 P2: a bare `Key` suffix is a diagnostic, not a credential.
        '{"queryKey":["events",42],"primaryKey":17}',
        // r5 P1: a non-secret key still leaves its own value alone.
        'message: hello',
        // r6: broadening the compound must not swallow these — only a
        // TRAILING `pwd`, and only a credential noun in front of `key`.
        '{"pwdTimeout":30,"monkey":"george","hotkey":"ctrl+k","turnkey":true}',
    ])('leaves %j byte-identical', (input: string) => {
        expect(scrubSecretsFromText(input)).toBe(input);
    });

    it('stays linear on a 200k-character string', () => {
        const big = `${'a'.repeat(200_000)}?token=${'b'.repeat(200_000)}`;
        const started = Date.now();
        const scrubbed = scrubSecretsFromText(big);

        expect(scrubbed).toBe(`${'a'.repeat(200_000)}?token=[Filtered]`);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

/**
 * ROK-1838 r6: every row here was scrubbed BEFORE r5 and leaked after it. The
 * r5 compound rule demanded an underscore-joined `_key`, so hyphenated and
 * run-together camelCase credential names stopped matching, and `pwd` was an
 * exact name only, so `db_pwd=` shipped the password.
 */
describe('scrubSecretsFromText — r6 compound keys', () => {
    it.each([
        ['api-key=abc123', 'api-key=[Filtered]'],
        ['X-Api-Key: abc123', 'X-Api-Key:[Filtered]'],
        ['private-key=abc123', 'private-key=[Filtered]'],
        ['awsAccessKey=abc123', 'awsAccessKey=[Filtered]'],
        ['awsSecretAccessKey=abc123', 'awsSecretAccessKey=[Filtered]'],
        ['clientKey=abc123', 'clientKey=[Filtered]'],
        ['authKey=abc123', 'authKey=[Filtered]'],
        ['db_pwd=swordfish', 'db_pwd=[Filtered]'],
        ['db-pwd=swordfish', 'db-pwd=[Filtered]'],
    ])('scrubs %j', (input: string, expected: string) => {
        expect(scrubSecretsFromText(input)).toBe(expected);
        expect(scrubSecretsFromText(expected)).toBe(expected);
    });
});

/** r4 rule 1: a key is secret only when it is unambiguous. */
describe('isSecretKey', () => {
    it.each([
        'password', 'PASSWORD', 'passwd', 'pwd', 'secret', 'token', 'access_token', 'refresh_token',
        'id_token', 'api_key', 'apikey', 'Authorization', 'cookie', 'set-cookie', 'session',
        'sessionid', 'csrf', 'accessToken', 'clientSecret', 'apiKey', 'user_api_key',
        'secret_key', 'secretKey', 'private_key', 'privateKey', 'accessKey', 'signingKey',
        'encryptionKey', 'client_secret',
        // r6: hyphenated / camelCase compounds and the `pwd` suffix.
        'api-key', 'X-Api-Key', 'private-key', 'awsAccessKey', 'awsSecretAccessKey',
        'clientKey', 'authKey', 'db_pwd', 'db-pwd',
    ])('redacts %j', (key: string) => {
        expect(isSecretKey(key)).toBe(true);
    });

    it.each([
        'tokenCount', 'tokenizer', 'passwordPolicy', 'keyboard', 'code', 'state', 'key', 'url',
        // r5 P2: `key` on its own, and every non-credential compound of it.
        'status', 'queryKey', 'primaryKey', 'monkey', 'hotkey', 'Key',
        // r6: a leading `pwd` and a `key` with no credential noun in front.
        'pwdTimeout', 'turnkey', 'keyring',
    ])(
        'keeps %j',
        (key: string) => {
            expect(isSecretKey(key)).toBe(false);
        },
    );
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
        expect(scrubbed.message.length).toBeLessThanOrEqual(FEEDBACK_MESSAGE_MAX_CHARS);
        expect(CreateFeedbackSchema.safeParse(scrubbed).success).toBe(true);
        // r4: the cut lands exactly where `[Filtered]` starts, so it is taken
        // in FRONT of the placeholder, never through it.
        expect(scrubbed.message.endsWith('?token=')).toBe(true);
        // ...and a second scrub of the clamped text is a no-op that cannot
        // grow it back past the contract limit.
        expect(scrubSecretsFromText(scrubbed.message)).toBe(scrubbed.message);
    });

    it('clamps scrubbed client logs to the contract limit', () => {
        const clientLogs = `${'b'.repeat(49_992)}?token=x`;
        const scrubbed = scrubFeedbackPayload({ category: 'bug', message: 'ten chars.', clientLogs });

        expect(scrubbed.clientLogs?.length).toBeLessThanOrEqual(FEEDBACK_CLIENT_LOGS_MAX_CHARS);
        expect(scrubbed.clientLogs).not.toContain('?token=x');
        expect(CreateFeedbackSchema.safeParse(scrubbed).success).toBe(true);
        const clamped = scrubbed.clientLogs ?? '';
        expect(scrubSecretsFromText(clamped)).toBe(clamped);
    });

    it('leaves optional fields absent rather than undefined', () => {
        const scrubbed = scrubFeedbackPayload({ category: 'feature', message: 'nice to have' });
        expect('pageUrl' in scrubbed).toBe(false);
        expect('clientLogs' in scrubbed).toBe(false);
    });
});
