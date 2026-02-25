/**
 * Unit tests for profile navigation data (ROK-359).
 * Tests that the consolidated profile nav has exactly 5 sections,
 * each with the correct structure and paths.
 */
import { describe, it, expect } from 'vitest';
import { SECTIONS } from './profile-nav-data';

describe('profile-nav-data (ROK-359 consolidation)', () => {
    it('has exactly 5 sections', () => {
        expect(SECTIONS).toHaveLength(5);
    });

    it('section ids are unique', () => {
        const ids = SECTIONS.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes identity section pointing to /profile/identity', () => {
        const identity = SECTIONS.find((s) => s.id === 'identity');
        expect(identity).toBeDefined();
        expect(identity!.children).toHaveLength(1);
        expect(identity!.children[0].to).toBe('/profile/identity');
        expect(identity!.children[0].label).toBe('My Profile');
    });

    it('includes preferences section pointing to /profile/preferences', () => {
        const preferences = SECTIONS.find((s) => s.id === 'preferences');
        expect(preferences).toBeDefined();
        expect(preferences!.children[0].to).toBe('/profile/preferences');
        expect(preferences!.children[0].label).toBe('Preferences');
    });

    it('includes notifications section pointing to /profile/notifications', () => {
        const notifications = SECTIONS.find((s) => s.id === 'notifications');
        expect(notifications).toBeDefined();
        expect(notifications!.children[0].to).toBe('/profile/notifications');
        expect(notifications!.children[0].label).toBe('Notifications');
    });

    it('includes gaming section pointing to /profile/gaming', () => {
        const gaming = SECTIONS.find((s) => s.id === 'gaming');
        expect(gaming).toBeDefined();
        expect(gaming!.children[0].to).toBe('/profile/gaming');
        expect(gaming!.children[0].label).toBe('Gaming');
    });

    it('includes account section pointing to /profile/account', () => {
        const account = SECTIONS.find((s) => s.id === 'account');
        expect(account).toBeDefined();
        expect(account!.children[0].to).toBe('/profile/account');
        expect(account!.children[0].label).toBe('Account');
    });

    it('every section has a label string', () => {
        for (const section of SECTIONS) {
            expect(typeof section.label).toBe('string');
            expect(section.label.length).toBeGreaterThan(0);
        }
    });

    it('every section has an icon defined', () => {
        for (const section of SECTIONS) {
            expect(section.icon).toBeTruthy();
        }
    });

    it('every section child has a non-empty label and path starting with /profile/', () => {
        for (const section of SECTIONS) {
            for (const child of section.children) {
                expect(child.label.length).toBeGreaterThan(0);
                expect(child.to).toMatch(/^\/profile\//);
            }
        }
    });

    it('does not include old separate paths like /profile/identity/discord or /profile/identity/avatar', () => {
        const allPaths = SECTIONS.flatMap((s) => s.children.map((c) => c.to));
        expect(allPaths).not.toContain('/profile/identity/discord');
        expect(allPaths).not.toContain('/profile/identity/avatar');
        expect(allPaths).not.toContain('/profile/preferences/appearance');
        expect(allPaths).not.toContain('/profile/preferences/timezone');
        expect(allPaths).not.toContain('/profile/gaming/game-time');
        expect(allPaths).not.toContain('/profile/gaming/characters');
        expect(allPaths).not.toContain('/profile/danger/delete-account');
    });
});
