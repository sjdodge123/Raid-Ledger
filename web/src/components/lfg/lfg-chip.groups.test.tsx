/** ROK-2352 Q7 — one chip per game; "in N groups" only when the LFG is split. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LfgChip } from './lfg-chip';
import { groupsLine } from './lfg-chip-copy';

describe('groupsLine', () => {
    it('is null at 0/1/absent and names the count above one', () => {
        expect(groupsLine(undefined)).toBeNull();
        expect(groupsLine(1)).toBeNull();
        expect(groupsLine(3)).toBe('in 3 groups');
    });
});

describe('LfgChip groupCount', () => {
    it('adds the sub-line when the game has several groups', () => {
        render(<MemoryRouter><LfgChip activeCount={3} gameSlug="world-of-warcraft" groupCount={3} /></MemoryRouter>);
        expect(screen.getByTestId('lfg-chip-groups').textContent).toBe('in 3 groups');
        expect(screen.getByTestId('lfg-chip').getAttribute('aria-label')).toContain('in 3 groups');
    });

    it('renders no sub-line for a single group', () => {
        render(<MemoryRouter><LfgChip activeCount={3} gameSlug="valheim" groupCount={1} /></MemoryRouter>);
        expect(screen.queryByTestId('lfg-chip-groups')).toBeNull();
    });
});
