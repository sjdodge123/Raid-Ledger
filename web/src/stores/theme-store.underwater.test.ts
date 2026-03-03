/**
 * Tests for the underwater theme registration in the theme store (ROK-296).
 * Verifies the underwater theme is correctly registered and categorized.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock api-client and use-auth so the store module can load without
// the @raid-ledger/contract package being built.
vi.mock('../lib/api-client', () => ({
    updatePreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hooks/use-auth', () => ({
    getAuthToken: vi.fn().mockReturnValue(null),
}));

// We import the pure exports that don't require Zustand store initialization
import { THEME_REGISTRY, getLightThemes, getDarkThemes } from './theme-store';

describe('THEME_REGISTRY — underwater theme registration (ROK-296)', () => {
    it('includes the underwater theme', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater).toBeDefined();
    });

    it('has id "underwater"', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater!.id).toBe('underwater');
    });

    it('has name "Deep Sea"', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater!.name).toBe('Deep Sea');
    });

    it('has mode "dark"', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater!.mode).toBe('dark');
    });

    it('has isDark true (backward-compat flag)', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater!.isDark).toBe(true);
    });

    it('has preview surface color #0f1f35', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater!.preview.surface).toBe('#0f1f35');
    });

    it('has preview accent color #22d3a0', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(underwater!.preview.accent).toBe('#22d3a0');
    });

    it('has a tokens object (may be empty)', () => {
        const underwater = THEME_REGISTRY.find((t) => t.id === 'underwater');
        expect(typeof underwater!.tokens).toBe('object');
        expect(underwater!.tokens).not.toBeNull();
    });
});

describe('getDarkThemes — includes underwater (ROK-296)', () => {
    it('returns underwater as a dark theme', () => {
        const dark = getDarkThemes();
        const ids = dark.map((t) => t.id);
        expect(ids).toContain('underwater');
    });

    it('all returned themes have mode "dark"', () => {
        const dark = getDarkThemes();
        for (const t of dark) {
            expect(t.mode).toBe('dark');
        }
    });

    it('includes default-dark and space as well', () => {
        const dark = getDarkThemes();
        const ids = dark.map((t) => t.id);
        expect(ids).toContain('default-dark');
        expect(ids).toContain('space');
    });
});

describe('getLightThemes — does not include underwater (ROK-296)', () => {
    it('does not return underwater as a light theme', () => {
        const light = getLightThemes();
        const ids = light.map((t) => t.id);
        expect(ids).not.toContain('underwater');
    });

    it('all returned themes have mode "light"', () => {
        const light = getLightThemes();
        for (const t of light) {
            expect(t.mode).toBe('light');
        }
    });
});

describe('THEME_REGISTRY — existing themes not broken (ROK-296 regression)', () => {
    const expectedIds = ['default-dark', 'default-light', 'space', 'quest-log', 'underwater'];

    it('contains all expected theme IDs', () => {
        const ids = THEME_REGISTRY.map((t) => t.id);
        for (const id of expectedIds) {
            expect(ids).toContain(id);
        }
    });

    it('default-dark remains a dark theme', () => {
        const t = THEME_REGISTRY.find((r) => r.id === 'default-dark')!;
        expect(t.mode).toBe('dark');
        expect(t.isDark).toBe(true);
    });

    it('default-light remains a light theme', () => {
        const t = THEME_REGISTRY.find((r) => r.id === 'default-light')!;
        expect(t.mode).toBe('light');
        expect(t.isDark).toBe(false);
    });

    it('space remains a dark theme', () => {
        const t = THEME_REGISTRY.find((r) => r.id === 'space')!;
        expect(t.mode).toBe('dark');
        expect(t.isDark).toBe(true);
    });

    it('quest-log remains a light theme', () => {
        const t = THEME_REGISTRY.find((r) => r.id === 'quest-log')!;
        expect(t.mode).toBe('light');
        expect(t.isDark).toBe(false);
    });
});

describe('SUB_THEME_CONFIG — underwater entry (ROK-296)', () => {
    // We validate SUB_THEME_CONFIG behavior indirectly via useThemeStore.
    // The store applies scheme='underwater' and colorScheme='dark' when
    // the resolved theme is underwater. We test this at the applyTheme level
    // by checking document attributes after store initialization.

    beforeEach(() => {
        // Reset localStorage to a clean state
        localStorage.clear();
        // Reset DOM attributes
        document.documentElement.removeAttribute('data-scheme');
        document.documentElement.removeAttribute('data-variant');
        document.documentElement.style.colorScheme = '';
    });

    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('sets data-scheme="underwater" when underwater is the active dark theme', async () => {
        localStorage.setItem('raid_ledger_theme_mode', 'dark');
        localStorage.setItem('raid_ledger_dark_theme', 'underwater');
        localStorage.setItem('raid_ledger_light_theme', 'default-light');

        // Re-import the store fresh so it reads the new localStorage values
        vi.resetModules();
        // Re-apply mocks after resetModules
        vi.mock('../lib/api-client', () => ({ updatePreference: vi.fn().mockResolvedValue(undefined) }));
        vi.mock('../hooks/use-auth', () => ({ getAuthToken: vi.fn().mockReturnValue(null) }));

        const { useThemeStore } = await import('./theme-store');

        const resolved = useThemeStore.getState().resolved;
        expect(resolved.id).toBe('underwater');
        expect(document.documentElement.getAttribute('data-scheme')).toBe('underwater');
    });

    it('sets colorScheme to "dark" (not "underwater") for underwater theme', async () => {
        localStorage.setItem('raid_ledger_theme_mode', 'dark');
        localStorage.setItem('raid_ledger_dark_theme', 'underwater');
        localStorage.setItem('raid_ledger_light_theme', 'default-light');

        vi.resetModules();
        vi.mock('../lib/api-client', () => ({ updatePreference: vi.fn().mockResolvedValue(undefined) }));
        vi.mock('../hooks/use-auth', () => ({ getAuthToken: vi.fn().mockReturnValue(null) }));

        await import('./theme-store');

        expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('does not set data-variant for underwater theme', async () => {
        localStorage.setItem('raid_ledger_theme_mode', 'dark');
        localStorage.setItem('raid_ledger_dark_theme', 'underwater');
        localStorage.setItem('raid_ledger_light_theme', 'default-light');

        vi.resetModules();
        vi.mock('../lib/api-client', () => ({ updatePreference: vi.fn().mockResolvedValue(undefined) }));
        vi.mock('../hooks/use-auth', () => ({ getAuthToken: vi.fn().mockReturnValue(null) }));

        await import('./theme-store');

        expect(document.documentElement.getAttribute('data-variant')).toBeNull();
    });

    it('persists underwater as the dark theme in localStorage', async () => {
        localStorage.setItem('raid_ledger_theme_mode', 'dark');
        localStorage.setItem('raid_ledger_dark_theme', 'underwater');
        localStorage.setItem('raid_ledger_light_theme', 'default-light');

        vi.resetModules();
        vi.mock('../lib/api-client', () => ({ updatePreference: vi.fn().mockResolvedValue(undefined) }));
        vi.mock('../hooks/use-auth', () => ({ getAuthToken: vi.fn().mockReturnValue(null) }));

        await import('./theme-store');

        // The store should keep these values on init
        expect(localStorage.getItem('raid_ledger_dark_theme')).toBe('underwater');
        expect(localStorage.getItem('raid_ledger_theme_mode')).toBe('dark');
    });
});
