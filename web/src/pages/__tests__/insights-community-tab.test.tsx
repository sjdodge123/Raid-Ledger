/**
 * insights-community-tab.test.tsx (ROK-1099)
 *
 * Renders the full Community tab against MSW-mocked snapshot data and
 * asserts each of the 5 TDD testids is present. The SocialGraphCanvas
 * lazy chunk is mocked so jsdom doesn't need WebGL.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { InsightsCommunityTab } from '../insights-community-tab';

vi.mock('../../components/insights/community/SocialGraphCanvas', () => ({
    SocialGraphCanvas: () => <div data-testid="social-graph-canvas-stub">stub</div>,
}));

describe('InsightsCommunityTab (ROK-1099)', () => {
    it('renders all 5 panels once MSW-mocked data resolves', async () => {
        renderWithProviders(<InsightsCommunityTab />);

        await waitFor(() =>
            expect(screen.getByTestId('community-insights-radar')).toBeInTheDocument(),
        );
        expect(screen.getByTestId('community-insights-engagement')).toBeInTheDocument();
        expect(screen.getByTestId('community-insights-social-graph')).toBeInTheDocument();
        expect(screen.getByTestId('community-insights-temporal')).toBeInTheDocument();
        expect(screen.getByTestId('community-insights-key-insights')).toBeInTheDocument();

        // Key Insights panel renders a list (matches the TDD smoke assertion).
        const keyInsightsPanel = screen.getByTestId('community-insights-key-insights');
        await waitFor(() =>
            expect(keyInsightsPanel.querySelector('[role="list"]')).toBeInTheDocument(),
        );
    });
});
