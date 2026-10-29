import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { corePluginInfo, makePluginInfo, valheimPluginInfo } from '../../../test/factories/plugin-info';
import { PluginsPanel } from '../plugins-panel';
import { sortCoreFirst } from './plugin-order';

/** ROK-1969 §5.4 W10 — the panel note and Core-first order. */
describe('Manage Plugins panel — hub note', () => {
    it('W10: renders the hub note once under the header', () => {
        renderWithProviders(<PluginsPanel />);
        expect(screen.getByRole('heading', { name: 'Manage Plugins' })).toBeInTheDocument();
        expect(screen.getAllByTestId('plugins-hub-note')).toHaveLength(1);
        expect(screen.getByText('Hub widgets and tabs come from plugins.')).toBeInTheDocument();
    });

    it('sorts the built-in Core plugin first and keeps the rest in api order', () => {
        const sorted = sortCoreFirst([valheimPluginInfo(), makePluginInfo(), corePluginInfo()]);
        expect(sorted.map((p) => p.slug)).toEqual(['core', 'valheim', 'discord']);
    });
});
