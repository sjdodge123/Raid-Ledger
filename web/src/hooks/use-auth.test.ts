import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAuthToken, setAuthToken } from './use-auth';

const TOKEN_KEY = 'raid_ledger_token';

describe('setAuthToken / getAuthToken', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('stores a token retrievable by getAuthToken', () => {
        setAuthToken('test-jwt-token');
        expect(getAuthToken()).toBe('test-jwt-token');
    });

    it('overwrites an existing token', () => {
        setAuthToken('old-token');
        setAuthToken('new-token');
        expect(getAuthToken()).toBe('new-token');
    });

    it('stores the token under the expected localStorage key', () => {
        setAuthToken('my-token');
        expect(localStorage.getItem(TOKEN_KEY)).toBe('my-token');
    });
});
