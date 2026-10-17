/**
 * ROK-1830 S5b — the core "Recommended mods" frame: it heads whatever sources
 * the hub module contributes, and says so when the game has none.
 */
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubModSource } from '../../../plugins/hub-module';
import { RecommendedMods } from './recommended-mods';

function source(id: string, label: string, text: string): HubModSource {
    function Section(): JSX.Element { return <p data-testid={`${id}-body`}>{text}</p>; }
    return { id, label, component: Section };
}

describe('RecommendedMods', () => {
    it('heads the module source with the core title', () => {
        renderWithProviders(<RecommendedMods guildId={7} canEdit sources={[source('wow-addons', 'World of Warcraft addons', 'Details')]} />);
        expect(screen.getByRole('heading', { name: 'Recommended mods' })).toBeInTheDocument();
        expect(screen.getByTestId('guild-mod-source-wow-addons')).toBeInTheDocument();
        expect(screen.getByTestId('wow-addons-body')).toHaveTextContent('Details');
        // One source needs no band label — the frame's own title names it.
        expect(screen.queryByText('World of Warcraft addons')).not.toBeInTheDocument();
    });

    it('labels each band once a hub has more than one source', () => {
        renderWithProviders(<RecommendedMods guildId={7} canEdit sources={[source('a', 'Addons', 'A'), source('b', 'Server mods', 'B')]} />);
        expect(screen.getByText('Addons')).toBeInTheDocument();
        expect(screen.getByText('Server mods')).toBeInTheDocument();
    });

    it('an editor on a game with no source is told the frame is empty', () => {
        renderWithProviders(<RecommendedMods guildId={7} canEdit sources={[]} />);
        expect(screen.getByTestId('guild-recommended-mods-empty')).toBeInTheDocument();
    });

    it('a plain member sees no empty frame at all', () => {
        const { container } = renderWithProviders(<RecommendedMods guildId={7} canEdit={false} sources={[]} />);
        expect(container).toBeEmptyDOMElement();
    });
});
