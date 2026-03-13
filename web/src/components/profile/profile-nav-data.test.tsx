/**
 * Tests for getSections() profile navigation data (ROK-548).
 * Verifies the restructured sidebar sections with user-specific links.
 */
import { describe, it, expect } from 'vitest';
import { getSections } from './profile-nav-data';

describe('getSections (ROK-548)', () => {
    const userId = 42;

    it('returns sections with expected ids', () => {
        const sections = getSections(userId);
        const ids = sections.map(s => s.id);
        expect(ids).toEqual([
            'identity',
            'integrations',
            'preferences',
            'gaming',
            'account',
        ]);
    });

    it('identity section has My Profile linking to /users/{userId}', () => {
        const sections = getSections(userId);
        const identity = sections.find(s => s.id === 'identity')!;
        const myProfile = identity.children.find(c => c.label === 'My Profile');
        expect(myProfile).toBeDefined();
        expect(myProfile!.to).toBe('/users/42');
    });

    it('identity section has My Avatar linking to /profile/avatar', () => {
        const sections = getSections(userId);
        const identity = sections.find(s => s.id === 'identity')!;
        const myAvatar = identity.children.find(c => c.label === 'My Avatar');
        expect(myAvatar).toBeDefined();
        expect(myAvatar!.to).toBe('/profile/avatar');
    });

    it('integrations section has link to /profile/integrations', () => {
        const sections = getSections(userId);
        const integrations = sections.find(s => s.id === 'integrations')!;
        expect(integrations.children).toHaveLength(1);
        expect(integrations.children[0].to).toBe('/profile/integrations');
        expect(integrations.children[0].label).toBe('My Integrations');
    });

    it('preferences section has Preferences and Notifications', () => {
        const sections = getSections(userId);
        const prefs = sections.find(s => s.id === 'preferences')!;
        expect(prefs.children).toHaveLength(2);
        expect(prefs.children[0]).toEqual({ to: '/profile/preferences', label: 'Preferences' });
        expect(prefs.children[1]).toEqual({ to: '/profile/notifications', label: 'Notifications' });
    });

    it('gaming section has Game Time, Characters, and Watched Games', () => {
        const sections = getSections(userId);
        const gaming = sections.find(s => s.id === 'gaming')!;
        expect(gaming.children).toHaveLength(3);
        expect(gaming.children[0].to).toBe('/profile/gaming/game-time');
        expect(gaming.children[1].to).toBe('/profile/gaming/characters');
        expect(gaming.children[2].to).toBe('/profile/gaming/watched-games');
    });

    it('account section has Delete Account linking to /profile/account', () => {
        const sections = getSections(userId);
        const account = sections.find(s => s.id === 'account')!;
        expect(account.children).toHaveLength(1);
        expect(account.children[0]).toEqual({ to: '/profile/account', label: 'Delete Account' });
    });

    it('uses the provided userId for the My Profile link', () => {
        const sections = getSections(99);
        const identity = sections.find(s => s.id === 'identity')!;
        const myProfile = identity.children.find(c => c.label === 'My Profile');
        expect(myProfile!.to).toBe('/users/99');
    });
});
