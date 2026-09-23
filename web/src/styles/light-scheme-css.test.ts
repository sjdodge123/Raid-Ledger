import { describe, it, expect } from 'vitest';
import { lightSchemes, lightTextRules, parseSchemeGroup } from './light-scheme-css';

const LIGHT = ['light', 'celestial', 'sky'];

describe('light-scheme-css parsers (ROK-1586)', () => {
    it('reads a scheme list and rejects a list with anything else in it', () => {
        expect(parseSchemeGroup('[data-scheme="light"], [data-scheme="sky"]')).toEqual(['light', 'sky']);
        expect(parseSchemeGroup('.badge-overlay, .badge-overlay *')).toBeNull();
    });

    it('matches a repaint whatever order the :is(...) scheme list is written in', () => {
        const css = [
            ':is([data-scheme="celestial"],[data-scheme="light"],[data-scheme="sky"]) .text-red-400 { color: #991b1b; }',
            ':is([data-scheme="sky"],[data-scheme="celestial"],[data-scheme="light"]) .text-red-400\\/60 { color: rgba(153, 27, 27, 0.9); }',
            ':is([data-scheme="light"],[data-scheme="sky"],[data-scheme="celestial"]) .hover\\:text-red-300:hover { color: #7f1d1d; }',
        ].join('\n');
        expect(lightTextRules(css, LIGHT)).toEqual([
            { cls: 'text-red-400', hue: 'red', color: '#991b1b', alpha: 1 },
            { cls: 'text-red-400/60', hue: 'red', color: '#991b1b', alpha: 0.9 },
            { cls: 'hover:text-red-300', hue: 'red', color: '#7f1d1d', alpha: 1 },
        ]);
    });

    it('skips badge-overlay rules and rules scoped to only some light schemes', () => {
        const css = [
            ':is([data-scheme="light"],[data-scheme="sky"],[data-scheme="celestial"]) :is(.badge-overlay, .badge-overlay *).text-red-400 { color: #f87171; }',
            ':is([data-scheme="light"],[data-scheme="sky"]) .text-red-400 { color: #b91c1c; }',
        ].join('\n');
        expect(lightTextRules(css, LIGHT)).toEqual([]);
    });

    it('gives each light scheme its own surface/panel, falling back to the shared block', () => {
        const css = [
            ':is([data-scheme="light"],[data-scheme="sky"],[data-scheme="quest-log"]) { --color-surface: #FFFFFF; --color-panel: #f1f5f9; }',
            '[data-scheme="sky"] { --color-surface: #ffffff; --color-panel: #E8F0F7; }',
            '[data-scheme="sky"] .glass-card { --color-panel: #000000; }',
            '[data-variant="quest-log"] { --color-surface: #faf3e0; --color-panel: #f0e4c8; }',
        ].join('\n');
        expect(lightSchemes(css)).toEqual([
            { name: 'light', surface: '#ffffff', panel: '#f1f5f9' },
            { name: 'sky', surface: '#ffffff', panel: '#e8f0f7' },
            { name: 'quest-log', surface: '#faf3e0', panel: '#f0e4c8' },
        ]);
    });
});
