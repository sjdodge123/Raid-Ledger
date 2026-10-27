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

describe('ROK-1955: scrubTokenFromUrl — companion device secrets', () => {
    const TOKEN = `rlcd_${'Ab9_-'.repeat(8)}xyz`;

    it('filters an rlcd_ device token anywhere in a string', () => {
        expect(TOKEN).toHaveLength(48);
        expect(scrubTokenFromUrl(`device token ${TOKEN} rejected`)).toBe('device token [Filtered] rejected');
    });

    it.each([
        ['/companion/v1/devices/link/BCDF-GHJK', '/companion/v1/devices/link/[Filtered]'],
        ['https://raid.example.test/api/companion/v1/devices/link/bcdfghjk?x=1', 'https://raid.example.test/api/companion/v1/devices/link/[Filtered]?x=1'],
    ])('filters the user code in the preview path %s', (input, expected) => {
        expect(scrubTokenFromUrl(input)).toBe(expected);
        expect(scrubTokenFromUrl(expected)).toBe(expected);
    });

    it('keeps the poll and decision paths readable', () => {
        expect(scrubTokenFromUrl('/companion/v1/devices/link/poll')).toBe('/companion/v1/devices/link/poll');
        expect(scrubTokenFromUrl('/companion/v1/devices/link/decision')).toBe('/companion/v1/devices/link/decision');
        expect(scrubTokenFromUrl('/companion/v1/devices/link/preview')).toBe('/companion/v1/devices/link/preview');
    });
});

/** ROK-1955 Codex P2: the companion device-link user code (`/link#code=…`). */
describe('ROK-1955: scrubTokenFromUrl — device-link code', () => {
    it.each([
        ['https://rl.test/link#code=BCDF-GHJK', 'https://rl.test/link#code=[Filtered]'],
        ['/link?code=BCDFGHJK', '/link?code=[Filtered]'],
        ['/link?x=1&code=BCDF-GHJK#a=b&code=WXYZ-QRST', '/link?x=1&code=[Filtered]#a=b&code=[Filtered]'],
    ])('scrubs %s', (input, expected) => {
        expect(scrubTokenFromUrl(input)).toBe(expected);
    });

    it('scrubs a navigation breadcrumb carrying the fragment code', () => {
        const crumb = scrubBreadcrumb({ data: { from: '/link#code=BCDF-GHJK', to: '/link' } });
        expect(crumb.data).toEqual({ from: '/link#code=[Filtered]', to: '/link' });
    });

    it('leaves a non-param `code` alone', () => {
        expect(scrubTokenFromUrl('/link?unicode=1&zipcode=2')).toBe('/link?unicode=1&zipcode=2');
    });
});
