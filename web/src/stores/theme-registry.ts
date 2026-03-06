/**
 * Theme registry data and type definitions.
 * Pure data module -- no side effects, no store imports.
 */

export type ThemeMode = 'light' | 'dark';

export interface ThemeDefinition {
    id: string;
    name: string;
    mode: ThemeMode;
    /** @deprecated Use `mode` instead. Kept for backward compat. */
    isDark: boolean;
    /** Preview colors for the theme card UI */
    preview: { surface: string; accent: string };
    /** CSS custom property overrides applied when theme is active */
    tokens: Record<string, string>;
}

export const THEME_REGISTRY: ThemeDefinition[] = [
    {
        id: 'default-dark',
        name: 'Dark',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#0f172a', accent: '#10b981' },
        tokens: {},
    },
    {
        id: 'default-light',
        name: 'Light',
        mode: 'light',
        isDark: false,
        preview: { surface: '#ffffff', accent: '#10b981' },
        tokens: {},
    },
    {
        id: 'space',
        name: 'Space',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#0a0a1a', accent: '#8b5cf6' },
        tokens: {},
    },
    {
        id: 'quest-log',
        name: 'Quest Log',
        mode: 'light',
        isDark: false,
        preview: { surface: '#f4e8c1', accent: '#c9a84c' },
        tokens: {},
    },
    {
        id: 'underwater',
        name: 'Deep Sea',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#0c1b2f', accent: '#22d3a0' },
        tokens: {},
    },
    {
        id: 'sky',
        name: 'Sky',
        mode: 'light',
        isDark: false,
        preview: { surface: '#FFFFFF', accent: '#0284C7' },
        tokens: {},
    },
    {
        id: 'obsidian',
        name: 'Obsidian',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#111111', accent: '#2DD4BF' },
        tokens: {},
    },
    {
        id: 'dawn',
        name: 'Dawn Raid',
        mode: 'light',
        isDark: false,
        preview: { surface: '#FFF1E3', accent: '#E07B39' },
        tokens: {},
    },
    {
        id: 'ember',
        name: 'Ember Forge',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#1E1917', accent: '#E8600A' },
        tokens: {},
    },
    {
        id: 'holy',
        name: 'Holy',
        mode: 'light',
        isDark: false,
        preview: { surface: '#FFFFFF', accent: '#2563EB' },
        tokens: {},
    },
    {
        id: 'arctic',
        name: 'Arctic Night',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#0E1520', accent: '#5BC8F5' },
        tokens: {},
    },
    {
        id: 'celestial',
        name: 'Celestial',
        mode: 'light',
        isDark: false,
        preview: { surface: '#EDE8DC', accent: '#C9A84C' },
        tokens: {},
    },
    {
        id: 'bloodmoon',
        name: 'Blood Moon',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#1A0E0E', accent: '#CC2222' },
        tokens: {},
    },
    {
        id: 'forest',
        name: 'Midnight Forest',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#111A14', accent: '#00E5A0' },
        tokens: {},
    },
    {
        id: 'fel',
        name: 'Fel Green',
        mode: 'dark',
        isDark: true,
        preview: { surface: '#131613', accent: '#7FFF00' },
        tokens: {},
    },
];

/** Return only themes categorized as light */
export function getLightThemes(): ThemeDefinition[] {
    return THEME_REGISTRY.filter((t) => t.mode === 'light');
}

/** Return only themes categorized as dark */
export function getDarkThemes(): ThemeDefinition[] {
    return THEME_REGISTRY.filter((t) => t.mode === 'dark');
}
