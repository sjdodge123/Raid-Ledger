import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { CharacterHeaderDemo } from './character-header-demo';

describe('CharacterHeaderDemo (ROK-2140)', () => {
    it('shows the three action tiles, the token-coloured stat strip and the inline action menu', () => {
        render(<CharacterHeaderDemo />);
        expect(within(screen.getByTestId('demo-action-tiles')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sync', 'Import string', 'More']);
        const values = within(screen.getByTestId('demo-stat-tiles')).getAllByTestId('character-stat-tile').map((t) => t.firstElementChild?.className ?? '');
        expect(values[0]).toContain('text-item-level');
        expect(values[1]).toContain('text-warning');
        expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Change owner', 'Unlink character']);
    });
});
