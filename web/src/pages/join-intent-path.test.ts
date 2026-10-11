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
        expect(url.searchParams.getAll('token')).toEqual(['t#1']);
    });

    it('round-trips an ordinary intent unchanged', () => {
        const url = new URL(joinIntentPath({ intent: 'signup', eventId: '42', token: 'abc' }), 'https://rl.test');
        expect(Object.fromEntries(url.searchParams)).toEqual({ intent: 'signup', eventId: '42', token: 'abc' });
    });
});
