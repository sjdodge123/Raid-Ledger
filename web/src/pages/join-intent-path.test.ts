import { describe, it, expect } from 'vitest';
import { joinIntentPath } from './join-intent-path';

describe('joinIntentPath (ROK-1757)', () => {
    it('keeps & and # inside their own params instead of injecting new ones', () => {
        const path = joinIntentPath({ intent: 'x&token=evil#frag', eventId: '7&intent=y', token: 't#1' });
        const url = new URL(path, 'https://rl.test');
        expect(url.pathname).toBe('/join');
        expect(url.hash).toBe('');
        expect(url.searchParams.getAll('intent')).toEqual(['x&token=evil#frag']);
        expect(url.searchParams.getAll('eventId')).toEqual(['7&intent=y']);
    });

    it('round-trips an ordinary intent unchanged', () => {
        const url = new URL(joinIntentPath({ intent: 'signup', eventId: '42', token: 'abc' }), 'https://rl.test');
        expect(Object.fromEntries(url.searchParams)).toEqual({ intent: 'signup', eventId: '42' });
    });

    /**
     * ROK-1839 (Codex P1 / Opus MAJOR): the post-OAuth hop navigates here
     * CLIENT-SIDE, so the module-load strip in lib/query-token-capture never
     * re-runs and Sentry + Session Replay are already recording. A `token=`
     * in this path would land verbatim in a replay's rrweb Meta href.
     */
    it('never puts the intent token back in the URL', () => {
        const path = joinIntentPath({ intent: 'signup', eventId: '42', token: 'rok1839.secret.jwt' });
        expect(path, 'the rebuilt join URL must carry no sign-in token').not.toContain('token=');
        expect(path).not.toContain('rok1839.secret.jwt');
        expect(new URL(path, 'https://rl.test').searchParams.get('token')).toBeNull();
    });
});
