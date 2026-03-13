/**
 * Unit tests for profile navigation data (ROK-548).
 * Tests the restructured profile nav with getSections().
 * Updated from ROK-359 to reflect fragmented identity panel.
 */
import { describe, it, expect } from 'vitest';
import { getSections } from './profile-nav-data';

const TEST_USER_ID = 1;

describe('profile-nav-data — section structure (ROK-548)', () => {
    it('has exactly 5 sections', () => {
        expect(getSections(TEST_USER_ID)).toHaveLength(5);
    });

    it('section ids are unique', () => {
        const ids = getSections(TEST_USER_ID).map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes identity section with My Profile and My Avatar', () => {
        const identity = getSections(TEST_USER_ID).find((s) => s.id === 'identity');
        expect(identity).toBeDefined();
        expect(identity!.children).toHaveLength(2);
        expect(identity!.children[0].to).toBe(`/users/${TEST_USER_ID}`);
        expect(identity!.children[0].label).toBe('My Profile');
        expect(identity!.children[1].to).toBe('/profile/avatar');
        expect(identity!.children[1].label).toBe('My Avatar');
    });

    it('includes integrations section', () => {
        const integrations = getSections(TEST_USER_ID).find((s) => s.id === 'integrations');
        expect(integrations).toBeDefined();
        expect(integrations!.children[0].to).toBe('/profile/integrations');
    });

    it('includes preferences section with Preferences and Notifications', () => {
        const preferences = getSections(TEST_USER_ID).find((s) => s.id === 'preferences');
        expect(preferences).toBeDefined();
        expect(preferences!.children).toHaveLength(2);
        expect(preferences!.children[0].to).toBe('/profile/preferences');
        expect(preferences!.children[1].to).toBe('/profile/notifications');
    });

    it('includes gaming section with 3 children', () => {
        const gaming = getSections(TEST_USER_ID).find((s) => s.id === 'gaming');
        expect(gaming).toBeDefined();
        expect(gaming!.children).toHaveLength(3);
        expect(gaming!.children[0].to).toBe('/profile/gaming/game-time');
        expect(gaming!.children[1].to).toBe('/profile/gaming/characters');
        expect(gaming!.children[2].to).toBe('/profile/gaming/watched-games');
    });

    it('includes account section with Delete Account', () => {
        const account = getSections(TEST_USER_ID).find((s) => s.id === 'account');
        expect(account).toBeDefined();
        expect(account!.children[0].to).toBe('/profile/account');
    });
});

describe('profile-nav-data — invariants (ROK-548)', () => {
    it('every section has a label string', () => {
        for (const section of getSections(TEST_USER_ID)) {
            expect(typeof section.label).toBe('string');
            expect(section.label.length).toBeGreaterThan(0);
        }
    });

    it('every section has an icon defined', () => {
        for (const section of getSections(TEST_USER_ID)) {
            expect(section.icon).toBeTruthy();
        }
    });

    it('every child has a non-empty label and valid path', () => {
        for (const section of getSections(TEST_USER_ID)) {
            for (const child of section.children) {
                expect(child.label.length).toBeGreaterThan(0);
                expect(child.to).toMatch(/^\//);
            }
        }
    });

    it('does not include old separate paths', () => {
        const allPaths = getSections(TEST_USER_ID).flatMap((s) => s.children.map((c) => c.to));
        expect(allPaths).not.toContain('/profile/identity');
        expect(allPaths).not.toContain('/profile/identity/discord');
        expect(allPaths).not.toContain('/profile/identity/avatar');
        expect(allPaths).not.toContain('/profile/preferences/appearance');
        expect(allPaths).not.toContain('/profile/preferences/timezone');
        expect(allPaths).not.toContain('/profile/danger/delete-account');
    });
});
