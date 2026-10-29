/** ROK-1959 D-7 — the "Saves" chip renders only when the hub's kinds include save pictures. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { HubMediaKind } from '@raid-ledger/contract';
import { availableFilters } from '../../../lib/hub-media-query';
import { hubMediaItem } from '../../../test/mocks/hub-media-handlers';
import { HubGalleryChips } from './hub-gallery-chips';
import { hubGalleryTileLabel } from './hub-gallery-labels';

function renderFor(kinds: readonly HubMediaKind[], value: 'all' | 'save' = 'all', onChange = vi.fn()) {
    render(<HubGalleryChips filters={availableFilters(kinds)} value={value} onChange={onChange} />);
    return onChange;
}

const chipLabels = (): string[] => screen.getAllByRole('button').map((b) => b.textContent ?? '');

describe('HubGalleryChips — Saves (ROK-1959)', () => {
    it('shows All · Deaths · Screenshots · Saves when the hub has saves', () => {
        renderFor(['death', 'screenshot', 'save']);
        expect(chipLabels()).toEqual(['All', 'Deaths', 'Screenshots', 'Saves']);
        expect(screen.getByTestId('hub-gallery-chip-save')).toHaveAttribute('aria-pressed', 'false');
    });

    it('has no Saves chip when the hub has no save pictures', () => {
        renderFor(['death', 'screenshot']);
        expect(chipLabels()).toEqual(['All', 'Deaths', 'Screenshots']);
        expect(screen.queryByTestId('hub-gallery-chip-save')).toBeNull();
    });

    it('pressing Saves asks for the save filter; the chosen chip reads pressed', () => {
        const onChange = renderFor(['upload', 'save']);
        fireEvent.click(screen.getByTestId('hub-gallery-chip-save'));
        expect(onChange).toHaveBeenCalledWith('save');
    });

    it('a selected Saves chip is pressed and All is not', () => {
        renderFor(['upload', 'save'], 'save');
        expect(screen.getByTestId('hub-gallery-chip-save')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('hub-gallery-chip-all')).toHaveAttribute('aria-pressed', 'false');
    });

    it('a save tile reads "Save — <author>"', () => {
        const item = hubMediaItem(3, 'save', { authorName: 'Shadowheart', source: { type: 'bg3-save', label: 'Game save' } });
        expect(hubGalleryTileLabel(item)).toMatch(/^Save — Shadowheart, /);
    });
});
