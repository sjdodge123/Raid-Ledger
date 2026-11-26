/**
 * ROK-2370: the "last used" sign-in marker — round-trip, junk → null,
 * blocked storage never throws, and it never stores a token or an id.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL } from './config';
import { LAST_SIGNIN_KEY, clearLastSignin, readLastSignin, recordLastSignin } from './last-signin';

const user = {
    id: 42, discordId: '1234', username: 'rok', displayName: 'Roknua',
    avatar: null, customAvatarUrl: '/uploads/avatars/a.png',
};

afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('last-signin marker (ROK-2370)', () => {
    it('round-trips method, display name and avatar', () => {
        recordLastSignin('discord-app-code', user, 1000);
        expect(readLastSignin()).toEqual({
            method: 'discord-app-code', name: 'Roknua', avatarUrl: `${API_BASE_URL}/uploads/avatars/a.png`, at: 1000,
        });
    });

    it('falls back to the username when there is no display name, and null avatar', () => {
        recordLastSignin('password', { ...user, displayName: null, customAvatarUrl: null }, 5);
        expect(readLastSignin()).toEqual({ method: 'password', name: 'rok', avatarUrl: null, at: 5 });
    });

    it('stores no token and no user id', () => {
        recordLastSignin('discord', user, 1);
        const raw = localStorage.getItem(LAST_SIGNIN_KEY) ?? '';
        expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['at', 'avatarUrl', 'method', 'name']);
        expect(raw).not.toContain('1234');
    });

    it.each([
        ['not json', '{oops'],
        ['unknown method', JSON.stringify({ method: 'carrier-pigeon', name: 'x', avatarUrl: null, at: 1 })],
        ['missing name', JSON.stringify({ method: 'discord', avatarUrl: null, at: 1 })],
        ['array', '[]'],
    ])('drops a garbage value (%s) and returns null', (_label, value) => {
        localStorage.setItem(LAST_SIGNIN_KEY, value);
        expect(readLastSignin()).toBeNull();
        expect(localStorage.getItem(LAST_SIGNIN_KEY)).toBeNull();
    });

    it('clear removes the marker', () => {
        recordLastSignin('discord', user, 1);
        clearLastSignin();
        expect(readLastSignin()).toBeNull();
    });

    it('never throws when storage is blocked', () => {
        const boom = (): never => { throw new DOMException('blocked', 'SecurityError'); };
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(boom);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(boom);
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(boom);
        expect(() => recordLastSignin('discord', user, 1)).not.toThrow();
        expect(readLastSignin()).toBeNull();
        expect(() => clearLastSignin()).not.toThrow();
    });
});
