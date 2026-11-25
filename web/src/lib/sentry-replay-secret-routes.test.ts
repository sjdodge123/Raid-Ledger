/**
 * TDB L3350: Session Replay's rrweb Meta `href` cannot be scrubbed, so a
 * replay segment recorded on a route whose address IS a secret must never be
 * sent: the private poll share link, an invite code and the OAuth one-time
 * code on /auth/success.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    dropReplayOnSecretRoutes,
    isSecretRouteUrl,
    processReplayEvent,
} from './sentry-replay-secret-routes';

vi.mock('@sentry/react', () => ({
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    makeFetchTransport: vi.fn(() => ({ send: vi.fn(), flush: vi.fn() })),
}));

const SAFE_HREF = 'https://rl.test/events/42';
const SHARE = 'https://rl.test/p/poll/AbCdEfGhIjKlMnOpQrSt';

/** Each call is a fresh replay unless a `replayId` is shared on purpose. */
let replaySeq = 0;
function replayEvent(urls: unknown[], replayId = `r${++replaySeq}`): Record<string, unknown> {
    return { type: 'replay_event', replay_id: replayId, urls };
}

describe('isSecretRouteUrl', () => {
    it.each([
        SHARE,
        '/p/poll/AbCdEfGhIjKlMnOpQrSt',
        '/p/poll/[Filtered]',
        'https://rl.test/i/ab23cd45',
        'https://rl.test/auth/success?code=one-time-code',
        '/auth/success',
        'https://rl.test/h/AbCdEfGhIjKlMnOpQrSt',
        '/h/AbCdEfGhIjKlMnOpQrSt?ref=discord',
        // React Router matches paths case-insensitively, so these render too.
        '/P/POLL/AbCdEfGhIjKlMnOpQrSt',
        '/H/AbCdEfGhIjKlMnOpQrSt',
        '/Auth/Success?code=x',
    ])('treats %s as a secret route', (url) => {
        expect(isSecretRouteUrl(url)).toBe(true);
    });

    it.each([
        SAFE_HREF,
        '/events/1',
        '/invites',
        '/auth/successful-thing',
        '/polls/7',
        '/hubs/3',
        '/',
    ])('treats %s as an ordinary route', (url) => {
        expect(isSecretRouteUrl(url)).toBe(false);
    });

    it('fails closed: an unparseable URL counts as secret', () => {
        expect(isSecretRouteUrl('http://[')).toBe(true);
    });

    // React Router decodes each path segment before matching, so a
    // percent-encoded prefix still renders the secret page.
    it.each([
        '/%68/AbCdEfGhIjKlMnOpQrSt',
        'https://rl.test/%70/poll/AbCdEfGhIjKlMnOpQrSt',
        '/p/%70%6Fll/AbCdEfGhIjKlMnOpQrSt',
        '/%49/ab23cd45',
        '/%61uth/%73uccess?code=x',
    ])('decodes path segments like the router: %s is a secret route', (url) => {
        expect(isSecretRouteUrl(url)).toBe(true);
    });

    it('fails closed: a malformed percent-encoding counts as secret', () => {
        expect(isSecretRouteUrl('/%E0%A4%A/AbCdEfGhIjKlMnOpQrSt')).toBe(true);
        expect(isSecretRouteUrl('/events/%ZZ')).toBe(true);
    });
});

describe('dropReplayOnSecretRoutes', () => {
    it('drops a replay segment whose urls include a share-token page', () => {
        expect(dropReplayOnSecretRoutes(replayEvent([SAFE_HREF, SHARE]), SAFE_HREF)).toBeNull();
    });

    it('drops a replay segment whose urls include an invite or auth-success page', () => {
        const invite = replayEvent(['https://rl.test/i/ab23cd45']);
        const auth = replayEvent(['/auth/success?code=xyz']);
        expect(dropReplayOnSecretRoutes(invite, SAFE_HREF)).toBeNull();
        expect(dropReplayOnSecretRoutes(auth, SAFE_HREF)).toBeNull();
    });

    it('drops a segment flushed while the tab is still on a secret route', () => {
        expect(dropReplayOnSecretRoutes(replayEvent([]), SHARE)).toBeNull();
    });

    it('keeps a replay segment that never touched a secret route', () => {
        const event = replayEvent([SAFE_HREF, '/events/43']);
        expect(dropReplayOnSecretRoutes(event, SAFE_HREF)).toBe(event);
    });

    // After an error is sampled on a secret route the SDK flushes, clears its
    // urls and restarts recording under the SAME replay id with a fresh Meta
    // snapshot carrying the secret href; a later segment can look safe.
    it('keeps dropping a replay once it touched a secret route, even when later segments look safe', () => {
        expect(dropReplayOnSecretRoutes(replayEvent([SHARE], 'restarted'), SAFE_HREF)).toBeNull();
        expect(dropReplayOnSecretRoutes(replayEvent([], 'restarted'), SAFE_HREF)).toBeNull();
        expect(dropReplayOnSecretRoutes(replayEvent([SAFE_HREF], 'restarted'), SAFE_HREF)).toBeNull();
    });

    it('taints a replay whose segment was dropped for the current address alone', () => {
        expect(dropReplayOnSecretRoutes(replayEvent([], 'flushed-on-share'), SHARE)).toBeNull();
        expect(dropReplayOnSecretRoutes(replayEvent([SAFE_HREF], 'flushed-on-share'), SAFE_HREF)).toBeNull();
    });

    it('does not taint other replays', () => {
        expect(dropReplayOnSecretRoutes(replayEvent([SHARE], 'tainted'), SAFE_HREF)).toBeNull();
        const other = replayEvent([SAFE_HREF], 'clean');
        expect(dropReplayOnSecretRoutes(other, SAFE_HREF)).toBe(other);
    });

    it('fails closed: a replay segment without a replay id is dropped', () => {
        expect(dropReplayOnSecretRoutes({ type: 'replay_event', urls: [SAFE_HREF] }, SAFE_HREF)).toBeNull();
    });

    it('never drops a non-replay event (errors keep their scrubbed reporting)', () => {
        const error = { type: undefined, request: { url: SHARE } };
        expect(dropReplayOnSecretRoutes(error, SHARE)).toBe(error);
    });
});

describe('processReplayEvent', () => {
    it('drops a share-page segment', () => {
        expect(processReplayEvent(replayEvent([SHARE]))).toBeNull();
    });

    it('scrubs the urls of a segment it keeps', () => {
        const kept = processReplayEvent(replayEvent(['/join?token=abc']));
        expect(kept).toEqual(expect.objectContaining({ urls: ['/join?token=[Filtered]'] }));
    });

    it('is the processEvent of the ScrubReplayUrls integration', async () => {
        const { buildSentryOptions } = await import('./sentry-options');
        const integrations = buildSentryOptions(() => undefined).integrations;
        const list = Array.isArray(integrations) ? integrations : [];
        const scrubber = list.find((i) => i.name === 'ScrubReplayUrls');
        expect(scrubber?.processEvent).toBe(processReplayEvent);
    });
});
