import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { LayerWindowLabel } from './LayerWindowLabel';
import { toLayerBackgroundEvents } from './calendar-layer-events';

/** Vitest stubs CSS imports (even `?raw`), so read the shipped file directly. */
const css = readFileSync(resolve(__dirname, 'calendar-layers.css'), 'utf8');

const [EVENT] = toLayerBackgroundEvents([{
    kind: 'window', id: 'w', start: '2026-02-10T20:00:00Z', end: '2026-02-10T20:20:00Z',
    label: 'Server up · Valheim Dedicated', ariaLabel: 'Valheim Dedicated up 8:00 PM to 8:20 PM',
}], 'UTC');

/** The body of the first `@container (max-height: <h>)` block, or '' when absent. */
function containerRule(height: string): string {
    const at = css.indexOf(`@container (max-height: ${height})`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}\n}', at));
}

describe('LayerWindowLabel — short bands (Codex P2)', () => {
    it('renders the visible label in its own hook class with the full text as title, plus sr-only text', () => {
        if (!EVENT) throw new Error('fixture window produced no event');
        render(<LayerWindowLabel event={EVENT} />);
        const text = screen.getByText('Server up · Valheim Dedicated');
        expect(text).toHaveClass('rl-layer-window-text');
        expect(text).toHaveAttribute('title', 'Server up · Valheim Dedicated');
        expect(screen.getByTestId('layer-window-label')).toHaveAttribute('title', 'Server up · Valheim Dedicated');
        expect(screen.getByText('Valheim Dedicated up 8:00 PM to 8:20 PM')).toHaveClass('sr-only');
    });

    it('the band is a size container whose short heights ellipsise, then hide, the visible label', () => {
        expect(css).toMatch(/\.rl-layer-window\s*\{[^}]*container-type:\s*size/);
        expect(containerRule('2.75rem')).toMatch(/\.rl-layer-window-text\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis/);
        expect(containerRule('1rem')).toMatch(/\.rl-layer-window-text\s*\{[^}]*display:\s*none/);
    });
});
