/** ROK-1893 P3 (Codex P2) — a plain member sees and can clear the inherited hub. */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { InheritedHubLine } from './inherited-hub-line';

vi.mock('../hub/api/use-guild', () => ({
    useGuildPage: () => ({ data: { guild: { id: 7, name: 'Viking Crew', kind: 'game_community' } } }),
}));

describe('InheritedHubLine', () => {
    it('names the inherited hub and Remove clears the tag', () => {
        const onRemove = vi.fn();
        renderWithProviders(<InheritedHubLine hubId={7} onRemove={onRemove} />);
        expect(screen.getByTestId('inherited-hub-line').textContent).toContain('Tagged to Viking Crew');
        fireEvent.click(screen.getByRole('button', { name: 'Remove the hub tag' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
    });
});
