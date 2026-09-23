import { type ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';
import { SHELL_LATE_SETTLE_MS, SHELL_SETTLE_MS } from './use-shell-height';

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

/** Stands in for the observer on the shell's layout-viewport sentinel; `fire()` is that viewport resizing. */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    readonly callback: ResizeObserverCallback;
    disconnected = false;
    observe = vi.fn();
    unobserve = vi.fn();
    constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        FakeResizeObserver.instances.push(this);
    }
    disconnect() { this.disconnected = true; }
    fire() { this.callback([], this as unknown as ResizeObserver); }
}

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

function restoreAfterRotation() {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
    else installVisualViewport(undefined);
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
}

/** An iPad in landscape (1180 wide, 688 visible), on fake timers. */
function renderLandscape(children?: ReactNode) {
    vi.useFakeTimers();
    const vv = new FakeVisualViewport();
    vv.height = 688;
    installVisualViewport(vv);
    setLayoutWidth(1180);
    const view = renderLayout('/', children);
    return { vv, view, root: view.container.firstElementChild as HTMLElement };
}

const settle = () => act(() => { vi.advanceTimersByTime(SHELL_SETTLE_MS + 50); });

/**
 * ROK-1661 iPad plan 2026-09-23-1846-507b, steps 3 and 6: iOS fires `resize`
 * and `orientationchange` BEFORE a rotated viewport settles, and nothing fires
 * once it has. The shell read the height only at event time, so after a
 * landscape→portrait turn it kept a floor ~80 px short of the portrait screen.
 */
describe('Regression: ROK-1661 — shell floor re-reads the viewport after a rotation settles', () => {
    afterEach(restoreAfterRotation);

    it('landscape→portrait: resize fires mid-rotation, the floor still lands on the settled portrait height', () => {
        const { vv, root } = renderLandscape();
        setLayoutWidth(820);
        resize(vv, 966);
        vv.height = 1048;
        settle();
        expect(root.style.minHeight).toBe('1048px');
    });

    it('an orientationchange with no resize after it still moves the floor', () => {
        const { vv, root } = renderLandscape();
        setLayoutWidth(820);
        vv.height = 1048;
        act(() => { window.dispatchEvent(new Event('orientationchange')); });
        settle();
        expect(root.style.minHeight).toBe('1048px');
    });

    it('rotation with a field focused: a second resize before it settles is the new viewport, not the keyboard', () => {
        const { vv, root, view } = renderLandscape(<input aria-label="Search games" />);
        setLayoutWidth(820);
        resize(vv, 1048);
        act(() => { view.getByRole('textbox').focus(); });
        setLayoutWidth(1180);
        resize(vv, 1048);
        resize(vv, 688);
        expect(root.style.minHeight).toBe('688px');

        settle();
        resize(vv, 400);
        settle();
        expect(root.style.minHeight).toBe('688px');
    });

});

/**
 * ROK-1661: the re-reads no single event triggers (the layout-viewport sentinel
 * and the late timed read), and a rotation made with the keyboard up.
 */
describe('Regression: ROK-1661 — settle re-reads with no event, and a keyboard-up rotation', () => {
    afterEach(restoreAfterRotation);

    it('a layout-viewport resize with no event after it (the fixed sentinel) still moves the floor', () => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
        const { vv, root, view } = renderLandscape();
        setLayoutWidth(820);
        vv.height = 1048;
        act(() => { for (const observer of FakeResizeObserver.instances) observer.fire(); });
        settle();
        expect(root.style.minHeight).toBe('1048px');

        const sentinel = document.querySelector<HTMLElement>('[data-shell-viewport-sentinel]');
        expect(sentinel?.style.position).toBe('fixed');
        expect(sentinel?.style.pointerEvents).toBe('none');
        expect(sentinel?.style.visibility).toBe('hidden');
        view.unmount();
        expect(document.querySelector('[data-shell-viewport-sentinel]')).toBeNull();
        expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
    });

    it('a rotation still settling at the first timed re-read is caught by the late one', () => {
        const { vv, root } = renderLandscape();
        setLayoutWidth(820);
        resize(vv, 966);
        settle();
        vv.height = 1048;
        act(() => { vi.advanceTimersByTime(SHELL_LATE_SETTLE_MS - SHELL_SETTLE_MS); });
        expect(root.style.minHeight).toBe('1048px');
    });

    it('rotating with the keyboard up floors on the last height seen at the new width with nothing focused', () => {
        const { vv, root, view } = renderLandscape(<input aria-label="Search games" />);
        setLayoutWidth(820);
        resize(vv, 1048);
        settle();
        act(() => { view.getByRole('textbox').focus(); });
        resize(vv, 700);
        setLayoutWidth(1180);
        resize(vv, 330);
        settle();
        expect(root.style.minHeight).toBe('688px');
    });
});

/**
 * ROK-1661: closing the on-screen keyboard left iOS scrolled into the run-out
 * below a short page's footer. A page no taller than the floor goes back to the
 * scroll it had when the field was focused; a taller page is left alone.
 */
describe('Regression: ROK-1661 — a short page scrolls back once the keyboard closes', () => {
    const originalScrollY = Object.getOwnPropertyDescriptor(window, 'scrollY');

    afterEach(() => {
        vi.restoreAllMocks();
        if (originalScrollY) Object.defineProperty(window, 'scrollY', originalScrollY);
        else delete (window as { scrollY?: number }).scrollY;
        if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
        else installVisualViewport(undefined);
        delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
    });

    function setScrollY(y: number) {
        Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    }

    /** Focus at scrollY 40; the keyboard scrolls to 300 and shrinks the viewport; blur; it closes. */
    function typeAndDismiss(pageHeight: number) {
        const vv = new FakeVisualViewport();
        installVisualViewport(vv);
        Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: pageHeight });
        const view = renderLayout('/', <input aria-label="Search games" />);
        setScrollY(40);
        act(() => { view.getByRole('textbox').focus(); });
        setScrollY(300);
        resize(vv, 600);
        act(() => { view.getByRole('textbox').blur(); });
        resize(vv, 950);
        return view;
    }

    it('restores the scroll saved at focus on a page no taller than the floor, and leaves a taller page alone', () => {
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
        typeAndDismiss(2400).unmount();
        expect(scrollTo).not.toHaveBeenCalled();

        typeAndDismiss(950);
        expect(scrollTo).toHaveBeenCalledWith(0, 40);
    });
});
