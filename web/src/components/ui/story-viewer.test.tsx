import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StoryViewer, type StorySlide } from './story-viewer';
import { KenBurnsBackground } from './story-viewer.parts';

/** Media queries the fake `matchMedia` answers `true` for. */
let matching: string[] = [];
const realMatchMedia = window.matchMedia;

function fakeMatchMedia(query: string): MediaQueryList {
    return {
        matches: matching.includes(query), media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    };
}

const DESKTOP = '(min-width: 1024px)';
const REDUCED = '(prefers-reduced-motion: reduce)';

const SLIDES: StorySlide[] = [
    { id: 'intro', label: 'Intro', content: <p>Intro body</p> },
    { id: 'events', label: 'Events', content: () => <p>Events body</p>, background: <div data-testid="bg-events" /> },
    { id: 'summary', label: 'Summary', content: <button type="button">Share</button> },
];

function renderViewer(props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) {
    const onClose = vi.fn();
    const onIndexChange = vi.fn();
    const utils = render(
        <StoryViewer title="GG 2026" slides={SLIDES} onClose={onClose} onIndexChange={onIndexChange} {...props} />,
    );
    return { ...utils, onClose, onIndexChange };
}

const live = (): string => screen.getByRole('status').textContent ?? '';
const key = (k: string): void => { fireEvent.keyDown(window, { key: k }); };

beforeEach(() => {
    matching = [];
    window.matchMedia = fakeMatchMedia;
});
afterEach(() => {
    window.matchMedia = realMatchMedia;
    document.body.style.overflow = '';
});

describe('StoryViewer — structure', () => {
    it('is a named modal dialog that announces the first slide', () => {
        renderViewer();
        const dialog = screen.getByRole('dialog', { name: 'GG 2026' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(live()).toBe('Slide 1 of 3: Intro');
        const slide = screen.getByRole('group', { name: '1 of 3: Intro' });
        expect(slide).toHaveAttribute('aria-roledescription', 'slide');
        expect(screen.getByText('Intro body')).toBeInTheDocument();
    });

    it('renders one progress segment per slide, marking done/current/upcoming', () => {
        renderViewer({ initialIndex: 1 });
        const segs = screen.getAllByTestId('story-progress-segment');
        expect(segs.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming']);
    });

    it('renders a render-function slide and its background node', () => {
        renderViewer({ initialIndex: 1 });
        expect(screen.getByText('Events body')).toBeInTheDocument();
        expect(screen.getByTestId('bg-events')).toBeInTheDocument();
    });

    it('clamps an out-of-range initialIndex to the last slide', () => {
        renderViewer({ initialIndex: 9 });
        expect(live()).toBe('Slide 3 of 3: Summary');
    });
});

describe('StoryViewer — keyboard', () => {
    it('ArrowRight advances and ArrowLeft goes back, reporting each index', () => {
        const { onIndexChange } = renderViewer();
        key('ArrowRight');
        expect(live()).toBe('Slide 2 of 3: Events');
        key('ArrowLeft');
        expect(live()).toBe('Slide 1 of 3: Intro');
        expect(onIndexChange.mock.calls).toEqual([[1], [0]]);
    });

    it('stays on the first slide on ArrowLeft and the last on ArrowRight', () => {
        const { onIndexChange } = renderViewer();
        key('ArrowLeft');
        expect(live()).toBe('Slide 1 of 3: Intro');
        key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
        expect(live()).toBe('Slide 3 of 3: Summary');
        expect(onIndexChange).toHaveBeenCalledTimes(2);
    });

    it('Escape closes, and so does the close button', () => {
        const { onClose } = renderViewer();
        key('Escape');
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: 'Close GG 2026' }));
        expect(onClose).toHaveBeenCalledTimes(2);
    });
});

describe('StoryViewer — tap zones and swipe', () => {
    it('the right tap zone advances and the left one goes back', () => {
        renderViewer();
        fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
        expect(live()).toBe('Slide 2 of 3: Events');
        fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
        expect(live()).toBe('Slide 1 of 3: Intro');
    });

    it('a left swipe advances, a right swipe goes back, a vertical drag does nothing', () => {
        renderViewer();
        const stage = screen.getByTestId('story-stage');
        const swipe = (x0: number, x1: number, y1 = 200): void => {
            fireEvent.touchStart(stage, { touches: [{ clientX: x0, clientY: 200 }] });
            fireEvent.touchEnd(stage, { changedTouches: [{ clientX: x1, clientY: y1 }] });
        };
        swipe(300, 100);
        expect(live()).toBe('Slide 2 of 3: Events');
        swipe(100, 300);
        expect(live()).toBe('Slide 1 of 3: Intro');
        swipe(200, 180, 500);
        expect(live()).toBe('Slide 1 of 3: Intro');
    });
});

describe('StoryViewer — layout', () => {
    it('phone: full-screen, no side arrows', () => {
        renderViewer();
        expect(screen.getByTestId('story-viewer')).toHaveAttribute('data-layout', 'phone');
        expect(screen.queryByTestId('story-side-arrow-next')).toBeNull();
    });

    it('desktop: centred card with side arrows disabled at the bounds', () => {
        matching = [DESKTOP];
        renderViewer();
        expect(screen.getByTestId('story-viewer')).toHaveAttribute('data-layout', 'desktop');
        const prev = screen.getByTestId('story-side-arrow-prev');
        const next = screen.getByTestId('story-side-arrow-next');
        expect(prev).toBeDisabled();
        fireEvent.click(next); fireEvent.click(next);
        expect(live()).toBe('Slide 3 of 3: Summary');
        expect(next).toBeDisabled();
        expect(prev).not.toBeDisabled();
    });
});

describe('StoryViewer — focus', () => {
    beforeEach(() => {
        // jsdom has no layout, so every element's offsetParent is null; the trap skips those.
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            configurable: true, get(this: HTMLElement) { return this.parentNode; },
        });
    });
    afterEach(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
    });

    it('moves focus into the dialog and wraps Tab from the last control to the first', async () => {
        renderViewer({ initialIndex: 2 });
        await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
        const dialog = screen.getByRole('dialog');
        expect(dialog.contains(document.activeElement)).toBe(true);
        const share = screen.getByRole('button', { name: 'Share' });
        share.focus();
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled])'));
        const last = focusables[focusables.length - 1];
        last?.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(document.activeElement).toBe(focusables[0]);
    });

    it('locks body scroll while open', () => {
        renderViewer();
        expect(document.body.style.overflow).toBe('hidden');
    });
});

describe('KenBurnsBackground — reduced motion', () => {
    it('animates the screenshot by default', () => {
        render(<KenBurnsBackground src="/shot.jpg" />);
        const img = screen.getByTestId('ken-burns-image');
        expect(img).toHaveAttribute('data-motion', 'ken-burns');
        expect(img.className).toContain('story-ken-burns');
    });

    it('is a static still under prefers-reduced-motion', () => {
        matching = [REDUCED];
        render(<KenBurnsBackground src="/shot.jpg" />);
        const img = screen.getByTestId('ken-burns-image');
        expect(img).toHaveAttribute('data-motion', 'static');
        expect(img.className).not.toContain('story-ken-burns');
    });

    it('the slide entrance animation is dropped under prefers-reduced-motion', () => {
        matching = [REDUCED];
        renderViewer();
        expect(screen.getByRole('group', { name: '1 of 3: Intro' }).className).not.toContain('story-slide-in');
    });
});
