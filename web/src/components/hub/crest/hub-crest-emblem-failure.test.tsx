/**
 * ROK-1814 fix lane 3 — a preset crest whose emblem art chunk fails to load
 * shows the usual fallback (shield on lists, initials in the hero), never a
 * blank coloured square.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GuildCrest } from '@raid-ledger/contract';
import { HubCrest } from './hub-crest';

vi.mock('./crest-emblems-lazy', () => ({
    useCrestEmblemArt: () => ({ status: 'failed', art: null }),
}));

const PRESET: GuildCrest = { source: 'preset', emblemId: 'wolf-head', fg: 'or', bg: 'azure' };

describe('HubCrest — emblem art failed to load', () => {
    it('a list size falls back to the shield', () => {
        render(<HubCrest crest={PRESET} name="Iron Vanguard" size="sm" />);
        expect(screen.getByTestId('hub-crest')).toHaveAttribute('data-crest', 'shield');
        expect(screen.queryByTestId('hub-crest-emblem')).toBeNull();
    });

    it('the hero falls back to the initials', () => {
        render(<HubCrest crest={PRESET} name="Iron Vanguard" size="hero" />);
        expect(screen.getByTestId('hub-crest')).toHaveAttribute('data-crest', 'initials');
        expect(screen.getByTestId('hub-crest')).toHaveTextContent('IV');
    });
});
