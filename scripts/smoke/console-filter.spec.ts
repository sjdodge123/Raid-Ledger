/**
 * Unit tests for the smoke console-error allowlist.
 *
 * ROK-1466: the fleet suite runs against the PUBLIC slot host
 * (https://slot-N.gamernight.net), where Cloudflare injects
 * `static.cloudflareinsights.com/beacon.min.js` into every response. The app's
 * CSP does not allow that origin, so the browser reports a violation on every
 * page — 4 of the 8 full-run failures were the "no critical console errors"
 * assertions tripping on an artefact of the proxy, never seen on localhost or
 * in GitHub CI.
 */
import { describe, it, expect } from 'vitest';
import { filterBenignErrors } from './console-filter';

describe('filterBenignErrors', () => {
    it('keeps a genuine application fault', () => {
        expect(
            filterBenignErrors(["TypeError: Cannot read properties of undefined"]),
        ).toHaveLength(1);
    });

    it('drops the known navigation-race noise', () => {
        expect(
            filterBenignErrors([
                'AbortError: The user aborted a request.',
                'ResizeObserver loop completed with undelivered notifications.',
                'Failed to load resource: the server responded with a status of 404',
            ]),
        ).toEqual([]);
    });

    it('drops the Cloudflare beacon CSP violation injected on the public slot host', () => {
        expect(
            filterBenignErrors([
                "Refused to load the script 'https://static.cloudflareinsights.com/beacon.min.js/vcd15cbe7772f49c399c6a5babf22c1241717689176015' " +
                    "because it violates the following Content Security Policy directive: \"script-src 'self'\".",
            ]),
        ).toEqual([]);
    });

    it('drops a Cloudflare beacon violation reported by filename alone', () => {
        expect(
            filterBenignErrors([
                "[Report Only] Refused to connect to 'https://cloudflareinsights.com/cdn-cgi/rum' because it violates the following Content Security Policy directive: \"connect-src 'self'\".",
                'Refused to load the script beacon.min.js',
            ]),
        ).toEqual([]);
    });

    it('keeps every OTHER CSP violation fatal', () => {
        const errors = [
            "Refused to load the script 'https://evil.example/x.js' because it violates the following Content Security Policy directive: \"script-src 'self'\".",
            "Refused to execute inline script because it violates the following Content Security Policy directive: \"script-src 'self'\".",
        ];
        expect(filterBenignErrors(errors)).toEqual(errors);
    });
});
