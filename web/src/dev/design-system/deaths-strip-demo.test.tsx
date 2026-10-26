/**
 * ROK-1941 — /dev/design-system demo of the "thumbnail strip in a meter row"
 * pattern: the REAL `ValheimDeathsPictures` under a meter row, wired to the
 * Gallery demo's hub (-1) so a thumb opens that demo's viewer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { useHubGalleryStore } from '../../components/hub/gallery/hub-gallery-store';
import DeathsStripDemo from './deaths-strip-demo';

beforeEach(() => { useHubGalleryStore.setState({ request: null }); });

describe('DeathsStripDemo', () => {
    it('draws three thumbs and "+N" as a sibling of the row link', () => {
        renderWithProviders(<DeathsStripDemo />);
        const group = screen.getByRole('group', { name: "Jasz's death pictures" });
        expect(within(group).getAllByTestId('valheim-death-thumb')).toHaveLength(3);
        expect(within(group).getByTestId('valheim-death-thumbs-more')).toHaveTextContent('+2');
        expect(screen.getByTestId('ds-deaths-strip-row').contains(group), 'the strip is not inside the row link').toBe(false);
    });

    it('a thumb opens the Gallery demo viewer at that death picture', async () => {
        renderWithProviders(<DeathsStripDemo />);
        const [first] = screen.getAllByTestId('valheim-death-thumb');
        if (!first) throw new Error('no thumb rendered');
        await userEvent.click(first);
        expect(useHubGalleryStore.getState().request).toMatchObject({ guildId: -1, mode: 'viewer', filter: 'death', mediaId: 1 });
    });
});
