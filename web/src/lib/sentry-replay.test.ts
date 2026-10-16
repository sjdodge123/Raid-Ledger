/**
 * ROK-1599 (Codex P1 r3): Session Replay must never record the subscribe
 * feed's bearer URL. Builds the REAL integration, so a Sentry upgrade that
 * moves the recording options fails here rather than silently leaking.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildReplayIntegration } from './sentry-replay';
import { guardFeedHrefs, maskFeedHref } from './sentry-replay-privacy';

const TOKEN = 'A'.repeat(43);
const WEBCAL = `webcal://raid.example.test/api/cal/u/${TOKEN}.ics`;
const HTTPS = `https://raid.example.test/api/cal/u/${TOKEN}.ics`;

type MaskAttributeFn = (key: string, value: string, el: HTMLElement) => string;
let built: object | null = null;

function recordingOption(replay: object, key: string): unknown {
    const options: unknown = Reflect.get(replay, '_recordingOptions');
    return typeof options === 'object' && options !== null ? Reflect.get(options, key) : undefined;
}

function buildMasker(): MaskAttributeFn {
    built = buildReplayIntegration();
    if (!built) throw new Error('buildReplayIntegration returned null: the feed-href guard did not install');
    const fn = recordingOption(built, 'maskAttributeFn');
    if (typeof fn !== 'function') throw new Error('Replay recording options carry no maskAttributeFn');
    return (key, value, el) => String(Reflect.apply(fn, undefined, [key, value, el]));
}

afterEach(() => {
    // The SDK allows one Replay per page; let the next test build its own.
    if (built) Reflect.set(built, '_isInitialized', false);
    built = null;
});

describe('ROK-1599: Session Replay never records a feed URL', () => {
    it('masks a webcal: and an https feed href, keeping no token character', () => {
        const mask = buildMasker();
        const a = document.createElement('a');
        for (const href of [WEBCAL, HTTPS]) {
            const out = mask('href', href, a);
            expect(out, `href ${href.slice(0, 20)}… was recorded unmasked`).not.toContain(TOKEN.slice(0, 8));
            expect(out).toMatch(/^\*+$/);
        }
    });

    it('leaves an ordinary href alone and still masks the SDK default attributes', () => {
        const mask = buildMasker();
        const a = document.createElement('a');
        expect(mask('href', '/events/12', a)).toBe('/events/12');
        expect(mask('title', 'Raid night', a)).toBe('**** *****');
    });

    it('keeps the SDK default block selector, so [data-sentry-block] is honoured', () => {
        buildMasker();
        const selector = built ? recordingOption(built, 'blockSelector') : undefined;
        expect(typeof selector).toBe('string');
        const host = document.createElement('div');
        host.setAttribute('data-sentry-block', '');
        const anchor = host.appendChild(document.createElement('a'));
        expect(anchor.closest(String(selector))).toBe(host);
    });

    it('fails closed: no recording options → guard reports false', () => {
        expect(guardFeedHrefs({})).toBe(false);
        expect(guardFeedHrefs({ _recordingOptions: {} })).toBe(false);
    });

    it('maskFeedHref ignores non-URL attributes and non-feed URLs', () => {
        expect(maskFeedHref('data-testid', WEBCAL)).toBeNull();
        expect(maskFeedHref('href', 'https://raid.example.test/calendars')).toBeNull();
        expect(maskFeedHref('HREF', WEBCAL)).toMatch(/^\*+$/);
    });
});
