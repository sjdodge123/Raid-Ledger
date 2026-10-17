import { describe, it, expect } from 'vitest';
import { scrubBreadcrumb, scrubTokenFromUrl } from './sentry-scrub';

/** ROK-1366: backstop so a `token=` param never reaches Sentry verbatim. */
describe('ROK-1366: scrubTokenFromUrl', () => {
    it.each([
        ['https://rl.test/events/42#token=abc.def', 'https://rl.test/events/42#token=[Filtered]'],
        ['/events/42?tab=a#x=1&token=abc&y=2', '/events/42?tab=a#x=1&token=[Filtered]&y=2'],
        ['/join?token=intent.jwt', '/join?token=[Filtered]'],
        ['/join?token=a#token=b', '/join?token=[Filtered]#token=[Filtered]'],
    ])('scrubs %s', (input, expected) => {
        expect(scrubTokenFromUrl(input)).toBe(expected);
    });

    it.each(['/events/42#roster', '/a?mytoken=1', '/a?t=token=1', ''])(
        'leaves %j untouched',
        (url) => {
            expect(scrubTokenFromUrl(url)).toBe(url);
        },
    );
});

/** ROK-1750: the private-poll share token is a path segment, not a param. */
describe('ROK-1750: scrubTokenFromUrl — poll share token in the path', () => {
    const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
    it.each([
        [`https://rl.test/p/poll/${TOKEN}`, 'https://rl.test/p/poll/[Filtered]'],
        [`/p/poll/${TOKEN}?x=1`, '/p/poll/[Filtered]?x=1'],
        [`https://rl.test/api/scheduling-polls/share/${TOKEN}`, 'https://rl.test/api/scheduling-polls/share/[Filtered]'],
        [`POST /scheduling-polls/share/${TOKEN}/join`, 'POST /scheduling-polls/share/[Filtered]/join'],
        [`https://rl.test/api/scheduling-polls/share/${TOKEN}/join`, 'https://rl.test/api/scheduling-polls/share/[Filtered]/join'],
    ])('scrubs %s', (input, expected) => {
        expect(scrubTokenFromUrl(input)).toBe(expected);
    });

    it('leaves a short non-token segment alone', () => {
        expect(scrubTokenFromUrl('/p/poll/abc')).toBe('/p/poll/abc');
    });
});

describe('ROK-1366: scrubBreadcrumb', () => {
    it('scrubs navigation from/to', () => {
        const crumb = scrubBreadcrumb({
            category: 'navigation',
            data: { from: '/e?x=1#token=abc', to: '/e?x=1' },
        });
        expect(crumb.data).toEqual({ from: '/e?x=1#token=[Filtered]', to: '/e?x=1' });
    });

    it('scrubs a fetch/xhr url and a message, leaving other fields alone', () => {
        const crumb = scrubBreadcrumb({
            category: 'fetch',
            message: 'GET https://rl.test/x#token=abc',
            data: { url: 'https://rl.test/x?token=abc', method: 'GET', status_code: 200 },
        });
        expect(crumb.data).toEqual({ url: 'https://rl.test/x?token=[Filtered]', method: 'GET', status_code: 200 });
        expect(crumb.message).toBe('GET https://rl.test/x#token=[Filtered]');
    });

    it('passes a breadcrumb with no data through', () => {
        const crumb = { category: 'ui.click', message: 'button' };
        expect(scrubBreadcrumb(crumb)).toEqual({ category: 'ui.click', message: 'button' });
    });
});
