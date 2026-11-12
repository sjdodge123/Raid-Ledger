import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { StoryViewer, type StorySlide } from './story-viewer';
import { useStoryControls } from './story-controls';

let matching: string[] = [];
let hidden = false;
const realMatchMedia = window.matchMedia;

function fakeMatchMedia(query: string): MediaQueryList {
    return {
        matches: matching.includes(query), media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    };
}

const REDUCED = '(prefers-reduced-motion: reduce)';

function TrailerControl(): React.JSX.Element {
    const c = useStoryControls();
    return <button type="button" onClick={c.paused ? c.resume : c.pause}>{c.paused ? 'Resume trailer' : 'Play trailer'}</button>;
}

const SLIDES: StorySlide[] = [
    { id: 'intro', label: 'Intro', content: <TrailerControl /> },
    { id: 'events', label: 'Events', content: <p>Events body</p> },
    { id: 'summary', label: 'Summary', content: <p>Summary body</p> },
];

function renderViewer(props: Partial<React.ComponentProps<typeof StoryViewer>> = {}) {
    const onIndexChange = vi.fn();
    const utils = render(<StoryViewer title="GG 2026" slides={SLIDES} onClose={vi.fn()} onIndexChange={onIndexChange} {...props} />);
    return { ...utils, onIndexChange };
}

const live = (): string => screen.getByRole('status').textContent ?? '';
const tick = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const state = (): string | null => screen.getByTestId('story-viewer').getAttribute('data-autoplay');
const nextZone = (): HTMLElement => screen.getAllByRole('button', { name: 'Next slide' })[0] as HTMLElement;
const setHidden = (h: boolean): void => {
    hidden = h;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

beforeEach(() => {
    matching = [];
    hidden = false;
    window.matchMedia = fakeMatchMedia;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = realMatchMedia;
    Reflect.deleteProperty(document, 'hidden');
    document.body.style.overflow = '';
});

describe('StoryViewer — auto-advance timing', () => {
    it('advances after 7 s by default and the current segment fills over that time', () => {
        renderViewer();
        const fill = screen.getByTestId('story-progress-fill');
        expect(fill.style.animationDuration).toBe('7000ms');
        tick(6999);
        expect(live()).toBe('Slide 1 of 3: Intro');
        tick(1);
        expect(live()).toBe('Slide 2 of 3: Events');
    });

    it('a slide durationMs overrides autoAdvanceMs', () => {
        const slides = SLIDES.map((s, i) => (i === 0 ? { ...s, durationMs: 2000 } : s));
        renderViewer({ slides, autoAdvanceMs: 3000 });
        tick(2000);
        expect(live()).toBe('Slide 2 of 3: Events');
        tick(2999);
        expect(live()).toBe('Slide 2 of 3: Events');
        tick(1);
        expect(live()).toBe('Slide 3 of 3: Summary');
    });

    it('stops at the last slide instead of looping', () => {
        const { onIndexChange } = renderViewer();
        for (let i = 0; i < 8; i += 1) tick(7000); // one act per slide so each new timer is scheduled
        expect(live()).toBe('Slide 3 of 3: Summary');
        expect(onIndexChange.mock.calls).toEqual([[1], [2]]);
    });
});

describe('StoryViewer — hold and tap', () => {
    it('press-and-hold pauses, release resumes the remaining time, and the hold does not navigate', () => {
        renderViewer();
        tick(3000);
        fireEvent.pointerDown(nextZone());
        tick(200);
        expect(state()).toBe('paused');
        tick(20_000);
        fireEvent.pointerUp(nextZone());
        fireEvent.click(nextZone());
        expect(live()).toBe('Slide 1 of 3: Intro');
        expect(state()).toBe('running');
        tick(3799);
        expect(live()).toBe('Slide 1 of 3: Intro');
        tick(1);
        expect(live()).toBe('Slide 2 of 3: Events');
    });

    it('a quick tap still navigates and restarts the timer on the new slide', () => {
        renderViewer();
        tick(5000);
        fireEvent.pointerDown(nextZone());
        tick(100);
        fireEvent.pointerUp(nextZone());
        fireEvent.click(nextZone());
        expect(live()).toBe('Slide 2 of 3: Events');
        tick(6999);
        expect(live()).toBe('Slide 2 of 3: Events');
        tick(1);
        expect(live()).toBe('Slide 3 of 3: Summary');
    });

});

describe('StoryViewer — pausing', () => {
    it('Space toggles pause and the play/pause button follows it', () => {
        renderViewer();
        fireEvent.keyDown(window, { key: ' ' });
        expect(screen.getByRole('button', { name: 'Play story' })).toBeInTheDocument();
        tick(20_000);
        expect(live()).toBe('Slide 1 of 3: Intro');
        fireEvent.click(screen.getByRole('button', { name: 'Play story' }));
        expect(screen.getByRole('button', { name: 'Pause story' })).toBeInTheDocument();
        tick(7000);
        expect(live()).toBe('Slide 2 of 3: Events');
    });

    it('pauses while the tab is hidden', () => {
        renderViewer();
        tick(2000);
        setHidden(true);
        expect(state()).toBe('paused');
        tick(20_000);
        expect(live()).toBe('Slide 1 of 3: Intro');
        setHidden(false);
        tick(5000);
        expect(live()).toBe('Slide 2 of 3: Events');
    });

    it('slide content pauses through useStoryControls, scoped to its own slide', () => {
        renderViewer();
        fireEvent.click(screen.getByRole('button', { name: 'Play trailer' }));
        expect(screen.getByRole('button', { name: 'Resume trailer' })).toBeInTheDocument();
        tick(20_000);
        expect(live()).toBe('Slide 1 of 3: Intro');
        fireEvent.click(nextZone());
        tick(7000);
        expect(live()).toBe('Slide 3 of 3: Summary');
    });

    it('the paused prop holds the story', () => {
        const { rerender } = renderViewer({ paused: true });
        tick(20_000);
        expect(live()).toBe('Slide 1 of 3: Intro');
        rerender(<StoryViewer title="GG 2026" slides={SLIDES} onClose={vi.fn()} paused={false} />);
        tick(7000);
        expect(live()).toBe('Slide 2 of 3: Events');
    });
});

describe('StoryViewer — auto-advance off', () => {
    it('prefers-reduced-motion: tap only, a static segment, no play/pause button', () => {
        matching = [REDUCED];
        renderViewer();
        tick(30_000);
        expect(live()).toBe('Slide 1 of 3: Intro');
        expect(state()).toBe('off');
        expect(screen.queryByTestId('story-progress-fill')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pause story' })).toBeNull();
    });

    it('autoAdvance={false} disables it', () => {
        renderViewer({ autoAdvance: false });
        tick(30_000);
        expect(live()).toBe('Slide 1 of 3: Intro');
        expect(state()).toBe('off');
    });
});
