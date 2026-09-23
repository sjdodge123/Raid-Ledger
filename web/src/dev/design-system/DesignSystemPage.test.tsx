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
import { useThemeStore } from '../../stores/theme-store';
import { GROUP_FILL, GROUP_GRADIENT } from '../../components/features/game-time/phone/week-strip.fills';

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
        'Semantic colour tokens',
        'Pattern — journey hero',
        'Pattern — week strip',
        'Pattern — group marks and legend',
        'Forms — the form primitives',
    ])('renders the "%s" section heading', (heading) => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeInTheDocument();
    });

    it('the Forms section mounts the real primitives, wired through Field', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        const forms = screen.getByTestId('ds-forms');
        const invalid = within(forms).getByRole('textbox', { name: 'Event name' });
        expect(invalid).toHaveAttribute('aria-invalid', 'true');
        expect(invalid).toHaveAccessibleDescription('Give the event a name.');
        expect(within(forms).getByRole('button', { name: 'Saving…' })).toHaveAttribute('aria-busy', 'true');
    });

    it('the Forms section mounts the slice-B controls (select, counter, checkbox, radios, slider)', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        const forms = screen.getByTestId('ds-forms');
        expect(within(forms).getByRole('combobox', { name: 'Timezone' })).toHaveAccessibleDescription('Pick a timezone.');
        expect(within(forms).getByRole('textbox', { name: 'Reason' })).toHaveAccessibleDescription(/\/200/);
        expect(within(forms).getByRole('checkbox', { name: 'Select all' })).toBePartiallyChecked();
        expect(within(forms).getByRole('radiogroup', { name: 'Duration' })).toBeInTheDocument();
        expect(within(forms).getByRole('radio', { name: '2h' })).toBeChecked();
        expect(within(forms).getByRole('slider', { name: 'Min owners' })).toHaveValue('3');
    });

    it('the Forms section mounts SearchInput and a working Combobox (slice C)', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        const forms = screen.getByTestId('ds-forms');
        expect(within(forms).getByRole('searchbox', { name: 'Search players' })).toHaveValue('thrall');
        expect(within(forms).getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
        const game = within(forms).getByRole('combobox', { name: 'Game' });
        expect(game).toHaveAttribute('aria-expanded', 'false');
        fireEvent.keyDown(game, { key: 'ArrowDown' });
        expect(game).toHaveAttribute('aria-expanded', 'true');
        expect(within(screen.getByRole('listbox', { name: 'Game' })).getAllByRole('option').length).toBeGreaterThan(1);
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

            for (const heading of ['Tokens', 'Accent hues', 'Pattern — filtering', 'Semantic colour tokens', 'Pattern — week strip']) {
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

        it('keeps a scheme picked WHILE the comparison is up (no stale restore)', () => {
            demoMode(true);
            renderWithProviders(<DesignSystemPage />);
            const select = screen.getByRole('combobox', { name: /scheme/i });
            fireEvent.change(select, { target: { value: 'sky' } });

            const toggle = screen.getByRole('button', { name: /side by side/i });
            fireEvent.click(toggle);
            expect(document.documentElement.getAttribute('data-scheme')).toBe('dark');

            // The viewer changes their mind with the comparison still on.
            fireEvent.change(select, { target: { value: 'ember' } });
            fireEvent.click(toggle);
            // Their later choice wins — it is NOT reverted to the pre-toggle 'sky'.
            expect(document.documentElement.getAttribute('data-scheme')).toBe('ember');
        });

        it('leaves a light viewer’s hidden dark-theme preference untouched', () => {
            demoMode(true);
            // A viewer resolved to a LIGHT scheme who also holds a custom dark theme.
            useThemeStore.getState().setDarkTheme('ember');
            useThemeStore.getState().setLightTheme('sky');
            useThemeStore.getState().setMode('light');
            expect(useThemeStore.getState().darkTheme).toBe('ember');

            const { unmount } = renderWithProviders(<DesignSystemPage />);
            fireEvent.click(screen.getByRole('button', { name: /side by side/i }));
            expect(document.documentElement.getAttribute('data-scheme')).toBe('dark');

            unmount();
            // Pinning writes setDarkTheme('default-dark'); the cleanup must put
            // the viewer's own dark theme back, not just the resolved light one.
            expect(useThemeStore.getState().darkTheme).toBe('ember');
            expect(useThemeStore.getState().lightTheme).toBe('sky');
            expect(useThemeStore.getState().themeMode).toBe('light');
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

describe('DesignSystemPage — ROK-1586 sections', () => {
    beforeEach(() => {
        mockUseSystemStatus.mockReset();
    });

    it('paints each semantic token in the class it documents, with both hexes', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        const success = screen.getByTestId('ds-semantic-success');
        expect(within(success).getByTitle('bg-success')).toHaveClass('bg-success');
        expect(within(success).getByTitle('border-success/30')).toHaveClass('border-success/30');
        expect(within(success).getByText('#10b981')).toBeInTheDocument();
        expect(within(success).getByText('#047857')).toBeInTheDocument();
        for (const name of ['warning', 'danger', 'busy', 'slot']) {
            expect(screen.getByTestId(`ds-semantic-${name}`)).toBeInTheDocument();
        }
        // D-6: the solid button fill stays raw, shown beside the token it must not become.
        expect(screen.getByTestId('ds-button-raw')).toHaveClass('bg-emerald-600');
        expect(screen.getByTestId('ds-button-token')).toHaveClass('bg-success');
    });

    it('mounts the real JourneyHero in all three tones at both widths', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        for (const width of ['phone', 'desktop']) {
            const frame = screen.getByTestId(`ds-hero-${width}`);
            expect(within(frame).getAllByRole('list', { name: 'Lineup progress' })).toHaveLength(3);
            expect(within(frame).getAllByTestId('journey-manage')).toHaveLength(3);
        }
    });

    it('paints the week-strip bars from the shipped fill maps', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getByTestId('ds-strip-group-all')).toHaveClass(GROUP_FILL.all);
        expect(screen.getByTestId('ds-strip-group-few')).toHaveClass('bg-danger/50');
        const split = screen.getByTestId('ds-strip-split');
        expect(split).toHaveClass('strip-bar-split');
        expect(split.style.getPropertyValue('--bar-l')).toBe(GROUP_GRADIENT.most);
        const busy = screen.getByTestId('ds-strip-busy');
        expect(busy.querySelector('[data-busy="true"]')).toHaveClass('bg-busy', 'w-[30%]');
    });

    it('mounts the real legend and marks cells with the shipped constants', () => {
        demoMode(true);
        renderWithProviders(<DesignSystemPage />);
        expect(screen.getAllByTestId('group-week-legend')).toHaveLength(2);
        expect(screen.getAllByText('Someone busy')).toHaveLength(2);
        expect(screen.getByTestId('group-week-members')).toHaveTextContent('6 members · 4 fresh');
        expect(screen.getByTestId('ds-cell-busy')).toHaveClass('before:bg-busy');
        expect(screen.getByTestId('ds-cell-slot')).toHaveClass('outline-slot');
        expect(screen.getByTestId('ds-cell-picked')).toHaveClass('ring-success');
    });
});
