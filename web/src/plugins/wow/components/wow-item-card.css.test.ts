/**
 * The item-name quality colours must come from theme tokens: a raw dark-theme hex
 * (common `#d4d4d8`, rare `#60a5fa`) is near-invisible on the light themes.
 * Same mixes as Quest Prep's `.quality-*` (ROK-2183).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'wow-item-card.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(selector: string): string {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(CSS);
    if (!match?.[1]) throw new Error(`no rule for ${selector}`);
    return match[1];
}

describe('wow-item-card.css text colours', () => {
    it.each(['poor', 'common', 'uncommon', 'rare', 'epic', 'legendary'])('the %s item name uses theme tokens', (quality) => {
        const rule = declarations(`.wow-item-card__name--${quality}`);
        expect(rule).toMatch(/color:[^;]*var\(--color-/);
        expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    });

    it('the enchant line uses theme tokens', () => {
        const rule = declarations('.wow-item-card__enchant');
        expect(rule).toMatch(/color:[^;]*var\(--color-/);
        expect(rule).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    });
});
