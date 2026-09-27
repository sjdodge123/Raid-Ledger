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
