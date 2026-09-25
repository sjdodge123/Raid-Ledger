import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

/**
 * ROK-1661 DEMO-only experiment affordances in the shell: `?noshellfloor=1`
 * drops the shell floor (plain flow), and `/dev/viewport-probe` renders with
 * no shell at all. Neither may change anything outside DEMO_MODE.
 */
const status = vi.hoisted(() => ({ demoMode: true }));
const useSystemStatus = vi.hoisted(() => vi.fn(() => ({ data: status })));
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus }));

vi.mock('./Header', () => ({ Header: () => <header data-testid="header" /> }));
vi.mock('./Footer', () => ({ Footer: () => <footer data-testid="footer" /> }));
vi.mock('./bottom-tab-bar', () => ({ BottomTabBar: () => null }));
vi.mock('./more-drawer', () => ({ MoreDrawer: () => null }));
vi.mock('./live-region-provider', () => ({ LiveRegionProvider: () => null }));
vi.mock('../feedback/FeedbackWidget', () => ({ FeedbackWidget: () => <div data-testid="feedback-fab" /> }));
vi.mock('./SpaceEffects', () => ({ SpaceEffects: () => null }));
vi.mock('./UnderwaterAmbience', () => ({ UnderwaterAmbience: () => null }));
vi.mock('../auth', () => ({ ImpersonationBanner: () => null }));
vi.mock('../ui/DiscordJoinBanner', () => ({ DiscordJoinBanner: () => null }));
vi.mock('../shared/CurrentUserAvatarSync', () => ({ CurrentUserAvatarSync: () => null }));
vi.mock('../../hooks/use-theme-sync', () => ({ useThemeSync: () => undefined }));
vi.mock('../../hooks/use-plugins', () => ({ usePluginHydration: () => undefined }));
vi.mock('../../hooks/use-media-query', () => ({ useMediaQuery: () => false }));

function renderLayout(path: string, children: ReactNode = <p>page content</p>) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Layout>{children}</Layout>
        </MemoryRouter>,
    );
}

function sentinel(): Element | null {
    return document.querySelector('[data-shell-viewport-sentinel]');
}

function expectFloored(root: HTMLElement) {
    expect(root).toHaveClass('min-h-dvh', 'bg-backdrop');
    expect(root.style.minHeight).toBe(`${window.innerHeight}px`);
    expect(sentinel()).not.toBeNull();
}

afterEach(() => {
    status.demoMode = true;
    useSystemStatus.mockClear();
});

describe('ROK-1661 experiment: ?noshellfloor=1 (DEMO_MODE only)', () => {
    it('without the flag the shell keeps both floors and never asks for DEMO_MODE', () => {
        const { container } = renderLayout('/calendar');
        expectFloored(container.firstElementChild as HTMLElement);
        expect(useSystemStatus).not.toHaveBeenCalled();
    });

    it('in DEMO_MODE the flag drops min-h-dvh, the inline floor and the viewport sentinel', async () => {
        const { container } = renderLayout('/calendar?noshellfloor=1');
        const root = container.firstElementChild as HTMLElement;
        await waitFor(() => expect(root).not.toHaveClass('min-h-dvh'));
        expect(root.style.minHeight).toBe('');
        expect(root).toHaveClass('bg-backdrop', 'flex', 'flex-col');
        expect(sentinel()).toBeNull();
        expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('outside DEMO_MODE (production) the flag changes nothing', async () => {
        status.demoMode = false;
        const { container } = renderLayout('/calendar?noshellfloor=1');
        await waitFor(() => expect(useSystemStatus).toHaveBeenCalled());
        expectFloored(container.firstElementChild as HTMLElement);
    });
});

describe('ROK-1661 experiment: /dev/viewport-probe renders with no app shell', () => {
    it('renders the page bare: no shell div, sentinel, header, footer or feedback widget', () => {
        const { container } = renderLayout('/dev/viewport-probe?mode=short', <p>probe page</p>);
        expect(container.firstElementChild).toBe(screen.getByText('probe page'));
        expect(sentinel()).toBeNull();
        for (const id of ['header', 'footer', 'feedback-fab']) expect(screen.queryByTestId(id)).toBeNull();
    });
});
