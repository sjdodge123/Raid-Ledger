/**
 * ROK-1814 — `HubCrest`: each crest source at each size, the image-error
 * fallback, an unknown (future) source, and the per-surface fallbacks (Q8).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GUILD_CREST_PALETTE, type GuildCrest } from '@raid-ledger/contract';
import { API_BASE_URL } from '../../../lib/config';
import { stripComments } from '../../../test/strip-comments';
import { HubCrest } from './hub-crest';

const hubCrestSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'hub-crest.tsx'), 'utf8');

const UPLOAD: GuildCrest = { source: 'upload', urlSm: '/uploads/guild-crests/11/abc.sm.webp', urlLg: '/uploads/guild-crests/11/abc.lg.webp' };
const PRESET: GuildCrest = { source: 'preset', emblemId: 'wolf-head', fg: 'or', bg: 'azure' };

function crestEl(): HTMLElement {
    return screen.getByTestId('hub-crest');
}

/** jsdom normalises inline hex colours to `rgb(r, g, b)`. */
function rgb(hex: string): string {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('HubCrest — no crest', () => {
    it('hero → initials in today\'s 64/80px box', () => {
        render(<HubCrest crest={null} name="Iron Vanguard" size="hero" />);
        expect(crestEl()).toHaveAttribute('data-crest', 'initials');
        expect(crestEl()).toHaveTextContent('IV');
        expect(crestEl()).toHaveClass('h-16', 'w-16', 'sm:h-20', 'sm:w-20', 'rounded-xl', 'border-2', 'border-edge-strong', 'bg-surface', 'text-secondary');
        expect(crestEl()).toHaveAttribute('aria-hidden', 'true');
    });

    it.each([['sm', 'h-6'], ['md', 'h-10'], ['lg', 'h-12']] as const)('%s → today\'s shield (%s box)', (size, box) => {
        render(<HubCrest crest={undefined} name="Iron Vanguard" size={size} />);
        expect(crestEl()).toHaveAttribute('data-crest', 'shield');
        expect(crestEl()).toHaveClass(box, 'rounded-lg', 'border', 'border-edge-strong', 'bg-overlay', 'text-success');
        expect(crestEl()).toHaveTextContent('');
    });

    it('an explicit fallback node replaces the shield (nav row: game icon)', () => {
        render(<HubCrest crest={null} name="X" size="sm" fallback={<img alt="" data-testid="game-icon" src="/g.png" />} />);
        expect(screen.getByTestId('game-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('hub-crest')).toBeNull();
    });
});

describe('HubCrest — upload', () => {
    it.each([['sm', '/uploads/guild-crests/11/abc.sm.webp'], ['md', '/uploads/guild-crests/11/abc.sm.webp'],
        ['lg', '/uploads/guild-crests/11/abc.lg.webp'], ['hero', '/uploads/guild-crests/11/abc.lg.webp']] as const)(
        '%s renders the API-prefixed %s', (size, url) => {
            render(<HubCrest crest={UPLOAD} name="Iron Vanguard" size={size} />);
            expect(crestEl()).toHaveAttribute('data-crest', 'upload');
            expect(screen.getByTestId('hub-crest-img')).toHaveAttribute('src', `${API_BASE_URL}${url}`);
        });

    it('an absolute URL is used as is', () => {
        render(<HubCrest crest={{ source: 'upload', urlSm: 'https://cdn.example/a.webp', urlLg: 'https://cdn.example/b.webp' }} name="X" size="sm" />);
        expect(screen.getByTestId('hub-crest-img')).toHaveAttribute('src', 'https://cdn.example/a.webp');
    });

    it('hero: an image error falls back to initials', () => {
        render(<HubCrest crest={UPLOAD} name="Iron Vanguard" size="hero" />);
        fireEvent.error(screen.getByTestId('hub-crest-img'));
        expect(crestEl()).toHaveAttribute('data-crest', 'initials');
        expect(crestEl()).toHaveTextContent('IV');
    });

    it('list size: an image error falls back to the shield', () => {
        render(<HubCrest crest={UPLOAD} name="Iron Vanguard" size="lg" />);
        fireEvent.error(screen.getByTestId('hub-crest-img'));
        expect(crestEl()).toHaveAttribute('data-crest', 'shield');
    });

    it('an image error falls back to an explicit fallback node', () => {
        render(<HubCrest crest={UPLOAD} name="X" size="sm" fallback={<span data-testid="game-icon" />} />);
        fireEvent.error(screen.getByTestId('hub-crest-img'));
        expect(screen.getByTestId('game-icon')).toBeInTheDocument();
    });
});

describe('HubCrest — preset', () => {
    it('paints the bg palette colour behind the emblem drawn in the fg colour', async () => {
        render(<HubCrest crest={PRESET} name="Iron Vanguard" size="hero" />);
        expect(crestEl()).toHaveAttribute('data-crest', 'preset');
        expect(crestEl().style.backgroundColor).toBe(rgb(GUILD_CREST_PALETTE.azure));
        const emblem = screen.getByTestId('hub-crest-emblem');
        expect(emblem).toHaveAttribute('data-emblem', 'wolf-head');
        expect(emblem.style.color).toBe(rgb(GUILD_CREST_PALETTE.or));
        await waitFor(() => expect(emblem.querySelectorAll('path').length).toBeGreaterThan(0));
    });

    it('keeps the emblem art out of the always-loaded module (lazy chunk only)', () => {
        const src = stripComments(hubCrestSource);
        expect(src).not.toMatch(/from\s+'\.\/crest-emblems'/);
        expect(src).not.toMatch(/crest-emblem-art/);
    });

    it('keeps the list box size', () => {
        render(<HubCrest crest={PRESET} name="X" size="sm" />);
        expect(crestEl()).toHaveClass('h-6', 'w-6', 'overflow-hidden');
    });
});

describe('HubCrest — unknown source (ROK-1170 forward-compat)', () => {
    it('hero renders initials, a list size the shield', () => {
        const { unmount } = render(<HubCrest crest={{ source: 'blizzard' }} name="Iron Vanguard" size="hero" />);
        expect(crestEl()).toHaveAttribute('data-crest', 'initials');
        unmount();
        render(<HubCrest crest={{ source: 'blizzard' }} name="Iron Vanguard" size="sm" />);
        expect(crestEl()).toHaveAttribute('data-crest', 'shield');
    });

    it('an upload missing its URLs is treated as unknown', () => {
        render(<HubCrest crest={{ source: 'upload' }} name="Iron Vanguard" size="hero" />);
        expect(crestEl()).toHaveAttribute('data-crest', 'initials');
    });
});
