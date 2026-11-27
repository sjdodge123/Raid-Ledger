/** ROK-2371: the `?linked=` toast branches on `provider=google`. */
import { describe, it, expect } from 'vitest';
import { linkResultToast } from './link-result-toast';

const at = (q: string) => linkResultToast(new URLSearchParams(q));

describe('linkResultToast', () => {
    it.each([
        ['linked=success', { kind: 'success', text: 'Discord account linked successfully!' }],
        ['linked=success&provider=google', { kind: 'success', text: 'Google account linked successfully!' }],
        ['linked=error', { kind: 'error', text: 'Failed to link Discord account' }],
        ['linked=error&provider=google', { kind: 'error', text: 'Failed to link Google account' }],
        ['linked=error&provider=google&message=Unlink%20your%20current%20Google%20account%20first',
            { kind: 'error', text: 'Unlink your current Google account first' }],
        ['linked=success&provider=steam', { kind: 'success', text: 'Discord account linked successfully!' }],
    ])('%s', (query, expected) => {
        expect(at(query)).toEqual(expected);
    });

    it('is null without a linked= result', () => {
        expect(at('steam=success')).toBeNull();
        expect(at('linked=maybe&provider=google')).toBeNull();
    });
});
