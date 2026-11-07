/**
 * ROK-2103 — a static-index shape lists its public entry names in a nested
 * collapsible, collapsed by default.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ForeverProbeShapes } from './forever-probe-shapes';

const shapes = {
    'forever:us:journal-expansion': {
        topLevelKeys: ['_links', 'tiers'],
        entryCount: 2,
        sample: [],
        names: ['Classic', 'Forever'],
    },
    'forever:us:realm': { topLevelKeys: ['realms'], entryCount: 1, sample: [] },
};

describe('ForeverProbeShapes names (ROK-2103)', () => {
    it('renders a collapsed "2 names" toggle that lists the names when expanded', () => {
        render(<ForeverProbeShapes shapes={shapes} />);
        const toggle = screen.getByText('2 names');
        const details = toggle.closest('details');
        expect(details).not.toBeNull();
        expect(details?.open).toBe(false);
        fireEvent.click(toggle);
        expect(details?.open).toBe(true);
        const list = screen.getByRole('list', { name: /forever:us:journal-expansion names/i });
        expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
            'Classic',
            'Forever',
        ]);
    });

    it('shows no names toggle for a shape without names', () => {
        render(<ForeverProbeShapes shapes={{ 'forever:us:realm': shapes['forever:us:realm'] }} />);
        expect(screen.queryByText(/names$/)).not.toBeInTheDocument();
    });
});

describe('ForeverProbeShapes keys-only arrays (ROK-2108)', () => {
    const deep = {
        'forever:us:ruleset-detail': {
            topLevelKeys: ['id', 'realms', 'tags'],
            entryCount: 0,
            sample: [],
            arrayKeys: { realms: ['slug', 'id'], tags: [] },
            arrayLengths: { realms: 3, tags: 0 },
        },
    };

    it('lists each array with its length and first-element keys, and drops "entries: 0"', () => {
        render(<ForeverProbeShapes shapes={deep} />);
        expect(screen.queryByText(/entries: 0/)).not.toBeInTheDocument();
        const toggle = screen.getByText('2 arrays');
        const details = toggle.closest('details');
        expect(details?.open).toBe(false);
        fireEvent.click(toggle);
        expect(details?.open).toBe(true);
        const list = screen.getByRole('list', { name: /forever:us:ruleset-detail arrays/i });
        expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
            'realms (length 3): slug, id',
            'tags (length 0): no keys',
        ]);
    });

    it('keeps "entries" and shows no arrays toggle for an ordinary shape', () => {
        render(<ForeverProbeShapes shapes={{ 'forever:us:realm': shapes['forever:us:realm'] }} />);
        expect(screen.getByText(/entries: 1/)).toBeInTheDocument();
        expect(screen.queryByText(/arrays?$/)).not.toBeInTheDocument();
    });
});
