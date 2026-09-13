/**
 * ROK-1539 — the design-system reference page must mount and must keep every
 * section. A section silently disappearing is how a reference page rots into
 * a lie, so each heading is asserted by name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { DesignSystemPage } from './DesignSystemPage';
import { THEME_REGISTRY } from '../../stores/theme-registry';

const mockUseSystemStatus = vi.fn();
vi.mock('../../hooks/use-system-status', () => ({
    useSystemStatus: () => mockUseSystemStatus(),
}));

function demoMode(enabled: boolean): void {
    mockUseSystemStatus.mockReturnValue({ data: { demoMode: enabled }, isLoading: false });
}

describe('DesignSystemPage', () => {
    beforeEach(() => {
        mockUseSystemStatus.mockReset();
    });

    it('renders the page header when DEMO_MODE is on', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByRole('heading', { name: /Raid Ledger — Design System/i, level: 1 })).toBeInTheDocument();
    });

    it.each([
        'Tokens',
        'Primitives — badges, chips, buttons, inputs, states',
        'Overlays and containers',
        'Pattern — filtering',
    ])('renders the "%s" section heading', (heading) => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    });

    it('shows the filtering DO and DON\'T side by side', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByTestId('ds-filter-do')).toBeInTheDocument();
        expect(screen.getByTestId('ds-filter-dont')).toBeInTheDocument();
        // The canonical panel owns "Clear all"; the bespoke copy has no such control.
        expect(screen.getByRole('button', { name: /clear all/i })).toBeInTheDocument();
    });

    it('renders token swatches for the surface roles', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        for (const token of ['--color-backdrop', '--color-surface', '--color-panel', '--color-foreground', '--color-edge']) {
            expect(screen.getByTestId(`swatch-live-${token}`)).toBeInTheDocument();
        }
    });

    describe('scheme switcher', () => {
        it('offers every registered scheme and starts on the viewer’s current one', () => {
            demoMode(true);
            renderWithProviders(<DesignSystemPage />);
            const select = screen.getByRole('combobox', { name: /scheme/i }) as HTMLSelectElement;
            expect(select.options).toHaveLength(THEME_REGISTRY.length);
            expect(THEME_REGISTRY.map((t) => t.id)).toContain(select.value);
        });

        it('writes data-scheme (and data-variant for quest-log) onto <html>', () => {
            demoMode(true);
            renderWithProviders(<DesignSystemPage />);
            const select = screen.getByRole('combobox', { name: /scheme/i });

            fireEvent.change(select, { target: { value: 'sky' } });
            expect(document.documentElement.getAttribute('data-scheme')).toBe('sky');
            expect(document.documentElement.hasAttribute('data-variant')).toBe(false);

            // quest-log is the one scheme applied through data-variant, not data-scheme.
            fireEvent.change(select, { target: { value: 'quest-log' } });
            expect(document.documentElement.getAttribute('data-variant')).toBe('quest-log');

            fireEvent.change(select, { target: { value: 'ember' } });
            expect(document.documentElement.getAttribute('data-scheme')).toBe('ember');
            expect(document.documentElement.hasAttribute('data-variant')).toBe(false);
        });
    });

    describe('side-by-side toggle', () => {
        it('is off by default — one copy of each section, no family columns', () => {
            demoMode(true);
            renderWithProviders(<DesignSystemPage />);
            expect(screen.queryByTestId('ds-family-dark')).not.toBeInTheDocument();
            expect(screen.getAllByRole('heading', { name: 'Tokens', level: 2 })).toHaveLength(1);
        });

        it('renders both families with the sections duplicated', () => {
            demoMode(true);
            renderWithProviders(<DesignSystemPage />);
            fireEvent.click(screen.getByRole('button', { name: /side by side/i }));

            const dark = screen.getByTestId('ds-family-dark');
            const light = screen.getByTestId('ds-family-light');
            // Light is genuinely scoped; dark shows the root, which is pinned below.
            expect(light).toHaveAttribute('data-scheme', 'light');
            expect(dark).not.toHaveAttribute('data-scheme');
            expect(dark.contains(light)).toBe(false);

            for (const heading of ['Tokens', 'Accent hues', 'Pattern — filtering']) {
                expect(within(dark).getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
                expect(within(light).getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
            }
            // The DO / DON'T pair is inside both columns, not only the dark one.
            expect(within(dark).getByTestId('ds-filter-dont')).toBeInTheDocument();
            expect(within(light).getByTestId('ds-filter-dont')).toBeInTheDocument();
        });

        it('pins the root to default-dark while on, and restores the scheme when off', () => {
            demoMode(true);
            renderWithProviders(<DesignSystemPage />);
            const select = screen.getByRole('combobox', { name: /scheme/i });
            fireEvent.change(select, { target: { value: 'sky' } });
            expect(document.documentElement.getAttribute('data-scheme')).toBe('sky');

            const toggle = screen.getByRole('button', { name: /side by side/i });
            fireEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-pressed', 'true');
            expect(document.documentElement.getAttribute('data-scheme')).toBe('dark');
            expect(screen.getByTestId('ds-side-by-side-note')).toBeInTheDocument();

            fireEvent.click(toggle);
            expect(toggle).toHaveAttribute('aria-pressed', 'false');
            expect(document.documentElement.getAttribute('data-scheme')).toBe('sky');
            expect(screen.queryByTestId('ds-family-light')).not.toBeInTheDocument();
        });

        it('restores the viewer’s scheme on unmount', () => {
            demoMode(true);
            const { unmount } = renderWithProviders(<DesignSystemPage />);
            fireEvent.change(screen.getByRole('combobox', { name: /scheme/i }), { target: { value: 'ember' } });
            fireEvent.click(screen.getByRole('button', { name: /side by side/i }));
            expect(document.documentElement.getAttribute('data-scheme')).toBe('dark');

            unmount();
            expect(document.documentElement.getAttribute('data-scheme')).toBe('ember');
        });
    });

    it('documents each accent hue with its dark shade and its light shade', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        const row = screen.getByTestId('ds-accent-text-emerald-400');
        expect(within(row).getByText('#34d399')).toBeInTheDocument();
        expect(within(row).getByText('#059669')).toBeInTheDocument();
    });

    it('renders nothing while system status is still loading', () => {
        mockUseSystemStatus.mockReturnValue({ data: undefined, isLoading: true });
        const { container } = renderWithProviders(<DesignSystemPage />);
        expect(container).toBeEmptyDOMElement();
    });

    it('redirects away when DEMO_MODE is off', () => {
        demoMode(false);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.queryByRole('heading', { name: /Raid Ledger — Design System/i })).not.toBeInTheDocument();
    });
});
