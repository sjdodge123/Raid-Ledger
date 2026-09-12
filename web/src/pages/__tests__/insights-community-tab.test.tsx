/**
 * insights-community-tab.test.tsx (ROK-1099)
 *
 * Renders the full Community tab against MSW-mocked snapshot data and
 * asserts each of the 5 TDD testids is present. The SocialGraphCanvas
 * lazy chunk is mocked so jsdom doesn't need WebGL.
 *
 * ROK-1310 appends a 6th panel (cohort game frequency); the extra case below
 * is the AC's no-regression clause — the new panel must render ALONGSIDE the
 * original five, not displace any of them.
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

    it('renders the ROK-1310 cohort-frequency panel below the original five', async () => {
        const { container } = renderWithProviders(<InsightsCommunityTab />);

        await waitFor(() =>
            expect(screen.getByTestId('community-insights-radar')).toBeInTheDocument(),
        );
        const cohort = await screen.findByTestId('community-insights-cohort-frequency');
        expect(cohort).toBeInTheDocument();

        // The original five are still mounted...
        for (const testid of [
            'community-insights-key-insights',
            'community-insights-radar',
            'community-insights-engagement',
            'community-insights-social-graph',
            'community-insights-temporal',
        ]) {
            expect(screen.getByTestId(testid)).toBeInTheDocument();
        }

        // ...and the new panel is the LAST child of the space-y-8 stack.
        const stack = container.querySelector('.space-y-8');
        expect(stack?.lastElementChild).toBe(cohort);
    });
});
