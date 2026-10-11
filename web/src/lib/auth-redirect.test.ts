/**
 * ROK-1757 — consumeAuthRedirect only ever returns a same-origin relative
 * path. The stored value is attacker-reachable in principle (any future
 * writer), so a full URL or protocol-relative host must never reach navigate().
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { saveAuthRedirect, consumeAuthRedirect } from './auth-redirect';

describe('consumeAuthRedirect — open-redirect guard (ROK-1757)', () => {
    beforeEach(() => sessionStorage.clear());

    it('returns a same-origin relative path unchanged', () => {
        saveAuthRedirect('/events/1');
        expect(consumeAuthRedirect()).toBe('/events/1');
    });

    it.each(['//evil.com', 'https://evil.com', '/\\evil.com'])(
        'drops %s so the caller falls back to its default',
        (hostile) => {
            saveAuthRedirect(hostile);
            expect(consumeAuthRedirect()).toBeNull();
        },
    );

    it('still clears both keys when the stored value is rejected', () => {
        saveAuthRedirect('https://evil.com');
        consumeAuthRedirect();
        expect(sessionStorage.getItem('authRedirect')).toBeNull();
        expect(sessionStorage.getItem('authRedirectSavedAt')).toBeNull();
    });
});
