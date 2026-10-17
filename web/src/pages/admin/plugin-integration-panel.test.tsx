import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PluginIntegrationPanel } from './plugin-integration-panel';
import { clearRegistry, registerSlotComponent } from '../../plugins/index';
import { usePluginStore } from '../../stores/plugin-store';

const FALLBACK = /No configuration UI available for this integration/;

/** Mirrors the real plugin slots: renders only for its own plugin slug. */
function slotFor(slug: string) {
    return function Slot({ pluginSlug }: { pluginSlug?: string }) {
        if (pluginSlug !== slug) return null;
        return <div data-testid={`${slug}-panel`}>{slug} panel</div>;
    };
}

function renderPanel(pluginSlug: string) {
    return render(
        <MemoryRouter initialEntries={[`/plugin/${pluginSlug}/main`]}>
            <Routes>
                <Route path="/plugin/:pluginSlug/:integrationKey" element={<PluginIntegrationPanel />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('PluginIntegrationPanel', () => {
    beforeEach(() => {
        clearRegistry();
        for (const slug of ['pelican', 'ai']) {
            registerSlotComponent({
                pluginSlug: slug,
                slotName: 'admin-settings:plugin-content',
                component: slotFor(slug),
                priority: 0,
            });
        }
    });

    it('renders the plugin panel when its plugin is active', () => {
        usePluginStore.setState({ activeSlugs: new Set(['pelican', 'ai']), initialized: true });
        renderPanel('pelican');
        expect(screen.getByTestId('pelican-panel')).toBeInTheDocument();
        expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
    });

    it('shows the fallback when the plugin is inactive but another plugin fills the slot', () => {
        usePluginStore.setState({ activeSlugs: new Set(['ai']), initialized: true });
        renderPanel('pelican');
        expect(screen.getByText(FALLBACK)).toBeInTheDocument();
        expect(screen.queryByTestId('pelican-panel')).not.toBeInTheDocument();
    });
});
