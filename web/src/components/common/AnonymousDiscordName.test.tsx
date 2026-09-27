import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { AnonymousDiscordName } from './AnonymousDiscordName';
import { lightSchemes, lightTextRules, parseSchemeGroup } from '../../styles/light-scheme-css';
import { stripComments } from '../../styles/wcag-contrast';

const css = stripComments(readFileSync(resolve(__dirname, '../../index.css'), 'utf-8'));
const LIGHT = lightSchemes(css).map((s) => s.name).sort();
const lightTextClasses = new Set(lightTextRules(css, LIGHT).map((r) => r.cls));

/** Every `.class` selector in a rule scoped to exactly the light scheme set, as written in markup. */
function lightScopedClasses(): Set<string> {
    const found = new Set<string>();
    for (const [, group, selector] of css.matchAll(/:is\(([^()]*)\)\s+\.([^\s{:]+)\s*\{/g)) {
        const names = parseSchemeGroup(group)?.sort();
        if (names && names.join() === LIGHT.join()) found.add(selector.replace(/\\\//g, '/'));
    }
    return found;
}

const RAW_HUE = /^(text|bg)-(red|amber|yellow|green|emerald|purple|indigo|cyan|blue)-\d{2,3}(\/\d{1,3})?$/;

function renderName() {
    const utils = render(<AnonymousDiscordName name="DiscordGuy" />);
    const chip = screen.getByText('via Discord');
    return { ...utils, chip, rawHue: chip.className.split(/\s+/).filter((c) => RAW_HUE.test(c)) };
}

describe('AnonymousDiscordName (ROK-1694)', () => {
    it('renders the Discord name and a "via Discord" chip, and never a link', () => {
        const { container } = renderName();
        expect(screen.getByText('DiscordGuy')).toBeInTheDocument();
        expect(container.querySelector('a'), 'an account-less Discord signup must not link anywhere').toBeNull();
    });

    it('every raw-hue class on the chip is repainted for the light schemes', () => {
        const { rawHue } = renderName();
        expect(LIGHT, 'light scheme set was not parsed out of index.css').toHaveLength(6);
        expect(rawHue.length, 'chip carries no raw-hue class — the guard is vacuous').toBeGreaterThan(0);
        const repainted = new Set([...lightTextClasses, ...lightScopedClasses()]);
        for (const cls of rawHue) {
            expect(
                repainted.has(cls),
                `${cls} on the "via Discord" chip has NO light repaint in index.css — it renders its dark-first shade on a light panel`,
            ).toBe(true);
        }
    });
});
