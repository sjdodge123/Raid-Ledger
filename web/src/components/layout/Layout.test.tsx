import { type ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';

// Layout pulls in a large tree of chrome (header/footer/nav/banners/effects)
// plus several hooks. None of that is relevant to this assertion, which is
// purely about the root container's utility classes. Mock the children and
// hooks down to no-ops so we can render Layout in isolation.
vi.mock('./Header', () => ({ Header: () => null }));
vi.mock('./Footer', () => ({ Footer: () => null }));
vi.mock('./bottom-tab-bar', () => ({ BottomTabBar: () => null }));
vi.mock('./more-drawer', () => ({ MoreDrawer: () => null }));
vi.mock('./live-region-provider', () => ({ LiveRegionProvider: () => null }));
vi.mock('../feedback/FeedbackWidget', () => ({ FeedbackWidget: () => null }));
vi.mock('./SpaceEffects', () => ({ SpaceEffects: () => null }));
vi.mock('./UnderwaterAmbience', () => ({ UnderwaterAmbience: () => null }));
vi.mock('../auth', () => ({ ImpersonationBanner: () => null }));
vi.mock('../ui/DiscordJoinBanner', () => ({ DiscordJoinBanner: () => null }));
vi.mock('../shared/CurrentUserAvatarSync', () => ({ CurrentUserAvatarSync: () => null }));
vi.mock('../../hooks/use-theme-sync', () => ({ useThemeSync: () => undefined }));
vi.mock('../../hooks/use-plugins', () => ({ usePluginHydration: () => undefined }));
vi.mock('../../hooks/use-media-query', () => ({ useMediaQuery: () => false }));

function renderLayout(path = '/', children: ReactNode = <p>scrolling content</p>) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Layout>{children}</Layout>
        </MemoryRouter>,
    );
}

/**
 * ROK-1341: On mobile the themed `bg-backdrop` background previously stopped
 * at one viewport because the root container used `min-h-screen`
 * (`min-height: 100vh`), which locks to a single viewport height. When content
 * scrolls beyond it the background cut off, revealing an unthemed band.
 * The fix swaps to `min-h-dvh` (dynamic viewport height) so the themed
 * container grows with content. BOTH layout root containers are covered: the
 * standard chrome path AND the chromeless (`/p/*` share-link) path, which is a
 * separate root `<div>` that carried the same bug.
 */
describe('Regression: ROK-1341 — mobile themed background covers full scroll height', () => {
    it('standard-path root container uses min-h-dvh so bg-backdrop grows with scroll height', () => {
        const { container } = renderLayout('/');
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('min-h-dvh');
        expect(root).toHaveClass('bg-backdrop');
    });

    it('standard-path root container does NOT use min-h-screen (locks background to one viewport)', () => {
        const { container } = renderLayout('/');
        const root = container.firstElementChild as HTMLElement;
        expect(root).not.toHaveClass('min-h-screen');
    });

    it('chromeless-path (/p/*) root container also uses min-h-dvh and not min-h-screen', () => {
        const { container } = renderLayout('/p/test-event');
        const root = container.firstElementChild as HTMLElement;
        expect(root).toHaveClass('min-h-dvh');
        expect(root).toHaveClass('bg-backdrop');
        expect(root).not.toHaveClass('min-h-screen');
    });
});

/**
 * ROK-1661: on a real iPad `100dvh` resolves ~100 CSS px taller than the
 * visible area (ROK-1640), so a short page (/calendar) pinned its footer below
 * the fold. The shell's min-height must follow `visualViewport.height`, with
 * `min-h-dvh` kept only as the first-paint fallback.
 */
class FakeVisualViewport extends EventTarget {
    height = 950;
    offsetTop = 0;
    scale = 1;
}

const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');

function installVisualViewport(vv: FakeVisualViewport | undefined) {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
}

function setLayoutWidth(px: number) {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: px });
}

function resize(vv: FakeVisualViewport, height: number) {
    act(() => { vv.height = height; vv.dispatchEvent(new Event('resize')); });
}

describe('Regression: ROK-1661 — shell min-height follows the visible viewport', () => {
    afterEach(() => {
        if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
        else installVisualViewport(undefined);
        delete (document.documentElement as { clientWidth?: number }).clientWidth;
    });

    it('pinch-zoom does not move the floor: 2x zoom (height 475, scale 2) keeps 950px', () => {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        const { container } = renderLayout('/');
        const root = container.firstElementChild as HTMLElement;
        act(() => { vv.scale = 2; vv.height = 475; vv.dispatchEvent(new Event('resize')); });
        expect(root.style.minHeight).toBe('950px');
    });

    it('holds the floor while the on-screen keyboard is up, and follows once focus leaves', () => {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        const { container, getByRole } = renderLayout('/', <input aria-label="Search games" />);
        const root = container.firstElementChild as HTMLElement;
        act(() => { getByRole('textbox').focus(); });
        resize(vv, 600);
        expect(root.style.minHeight).toBe('950px');

        act(() => { getByRole('textbox').blur(); });
        resize(vv, 600);
        expect(root.style.minHeight).toBe('600px');
    });

    it('a width change with an input focused is a rotation, not the keyboard, so the floor follows', () => {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        setLayoutWidth(1024);
        const { container, getByRole } = renderLayout('/', <input aria-label="Search games" />);
        const root = container.firstElementChild as HTMLElement;
        act(() => { getByRole('textbox').focus(); });
        setLayoutWidth(768);
        resize(vv, 600);
        expect(root.style.minHeight).toBe('600px');
    });

    it('chromeless /p/* main is a flex column, so a public page fills it with flex-1', () => {
        const { container } = renderLayout('/p/test-event');
        expect(container.querySelector('main#main-content')).toHaveClass('flex-1', 'flex', 'flex-col');
    });

    it.each([['standard path', '/'], ['chromeless /p/* path', '/p/test-event']])(
        '%s: min-height is visualViewport.height and tracks its resize',
        (_label, path) => {
            const vv = new FakeVisualViewport();
            installVisualViewport(vv);
            const { container } = renderLayout(path);
            const root = container.firstElementChild as HTMLElement;
            expect(root.style.minHeight).toBe('950px');
            expect(root).toHaveClass('min-h-dvh');

            act(() => { vv.height = 800; vv.dispatchEvent(new Event('resize')); });
            expect(root.style.minHeight).toBe('800px');
        },
    );
});
