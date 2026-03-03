/**
 * Tests for the UnderwaterAmbience component (ROK-296).
 * Verifies rendering, reduced-motion respect, visibility pause, and cleanup.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { UnderwaterAmbience } from './UnderwaterAmbience';

// ============================================================
// Mock theme-store
// ============================================================

const mockResolvedTheme = vi.fn();

vi.mock('../../stores/theme-store', () => ({
    useThemeStore: (selector: (s: { resolved: { id: string } }) => unknown) =>
        selector({ resolved: { id: mockResolvedTheme() } }),
}));

// ============================================================
// Mock canvas getContext (jsdom does not implement it)
// ============================================================

const mockClearRect = vi.fn();
const mockBeginPath = vi.fn();
const mockArc = vi.fn();
const mockFill = vi.fn();
const mockSave = vi.fn();
const mockRestore = vi.fn();
const mockTranslate = vi.fn();
const mockScale = vi.fn();
const mockEllipse = vi.fn();
const mockMoveTo = vi.fn();
const mockLineTo = vi.fn();
const mockClosePath = vi.fn();

const mockCtx = {
    clearRect: mockClearRect,
    beginPath: mockBeginPath,
    arc: mockArc,
    fill: mockFill,
    save: mockSave,
    restore: mockRestore,
    translate: mockTranslate,
    scale: mockScale,
    ellipse: mockEllipse,
    moveTo: mockMoveTo,
    lineTo: mockLineTo,
    closePath: mockClosePath,
    fillStyle: '',
    globalAlpha: 1,
};

// ============================================================
// Mock requestAnimationFrame / cancelAnimationFrame
// ============================================================

let rafCallbacks: Map<number, FrameRequestCallback> = new Map();
let rafIdCounter = 0;

function installRafMocks() {
    rafCallbacks = new Map();
    rafIdCounter = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        const id = ++rafIdCounter;
        rafCallbacks.set(id, cb);
        return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        rafCallbacks.delete(id);
    });
    vi.stubGlobal('performance', { now: vi.fn(() => 0) });
}

function flushRafOnce() {
    // Execute one tick of the animation loop
    const [id, cb] = [...rafCallbacks.entries()][0] ?? [];
    if (cb) {
        rafCallbacks.delete(id);
        cb(0);
    }
}

// ============================================================
// Setup / teardown
// ============================================================

beforeEach(() => {
    installRafMocks();

    // Default: not underwater
    mockResolvedTheme.mockReturnValue('default-dark');

    // Stub canvas getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCtx as unknown as CanvasRenderingContext2D);

    // Reset DOM dimensions
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true, configurable: true });

    vi.clearAllMocks();
    mockResolvedTheme.mockReturnValue('default-dark');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

// ============================================================
// Tests
// ============================================================

describe('UnderwaterAmbience — rendering (ROK-296)', () => {
    it('returns null when theme is not underwater', () => {
        mockResolvedTheme.mockReturnValue('default-dark');
        const { container } = render(<UnderwaterAmbience />);
        expect(container.firstChild).toBeNull();
    });

    it('returns null when theme is space', () => {
        mockResolvedTheme.mockReturnValue('space');
        const { container } = render(<UnderwaterAmbience />);
        expect(container.firstChild).toBeNull();
    });

    it('returns null when theme is default-light', () => {
        mockResolvedTheme.mockReturnValue('default-light');
        const { container } = render(<UnderwaterAmbience />);
        expect(container.firstChild).toBeNull();
    });

    it('renders a canvas element when theme is underwater', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas');
        expect(canvas).toBeInTheDocument();
    });

    it('canvas has aria-hidden="true" (not a11y obstacle)', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas');
        expect(canvas).toHaveAttribute('aria-hidden', 'true');
    });

    it('canvas has pointer-events-none class (never blocks interaction)', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas');
        expect(canvas).toHaveClass('pointer-events-none');
    });

    it('canvas is fixed-position and covers the full viewport', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas');
        expect(canvas).toHaveClass('fixed');
        expect(canvas).toHaveClass('inset-0');
    });

    it('canvas has z-0 so it stays behind content', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas');
        expect(canvas).toHaveClass('z-0');
    });
});

describe('UnderwaterAmbience — animation lifecycle (ROK-296)', () => {
    it('starts animation loop when theme is underwater', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        // requestAnimationFrame should have been called to kick off the loop
        expect(rafCallbacks.size).toBeGreaterThan(0);
    });

    it('does not start animation loop when theme is not underwater', () => {
        mockResolvedTheme.mockReturnValue('default-dark');
        render(<UnderwaterAmbience />);
        expect(rafCallbacks.size).toBe(0);
    });

    it('cancels animation frame on unmount', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        const cancelSpy = vi.spyOn(globalThis, 'cancelAnimationFrame');
        const { unmount } = render(<UnderwaterAmbience />);
        unmount();
        expect(cancelSpy).toHaveBeenCalled();
    });

    it('removes resize listener on unmount', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        const removeListener = vi.spyOn(window, 'removeEventListener');
        const { unmount } = render(<UnderwaterAmbience />);
        unmount();
        expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });

    it('removes visibilitychange listener on unmount', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        const removeDocListener = vi.spyOn(document, 'removeEventListener');
        const { unmount } = render(<UnderwaterAmbience />);
        unmount();
        expect(removeDocListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('adds visibilitychange listener when underwater', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        const addDocListener = vi.spyOn(document, 'addEventListener');
        render(<UnderwaterAmbience />);
        expect(addDocListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
});

describe('UnderwaterAmbience — tab visibility pause (ROK-296)', () => {
    it('skips canvas clear when document is hidden', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);

        // Simulate tab becoming hidden
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        // Flush one rAF tick — should skip clearRect
        flushRafOnce();

        expect(mockClearRect).not.toHaveBeenCalled();

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });

    it('resumes rendering when tab becomes visible again', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);

        // Hide then show tab
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        flushRafOnce();

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        flushRafOnce();

        // Now clearRect should have been called in the visible tick
        expect(mockClearRect).toHaveBeenCalled();
    });
});

describe('UnderwaterAmbience — canvas sizing (ROK-296)', () => {
    it('sets canvas width to window.innerWidth on init', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true, configurable: true });

        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas.width).toBe(1920);
    });

    it('sets canvas height to window.innerHeight on init', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        Object.defineProperty(window, 'innerWidth', { value: 1920, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 1080, writable: true, configurable: true });

        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas.height).toBe(1080);
    });

    it('updates canvas dimensions on window resize', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;

        // Simulate resize
        Object.defineProperty(window, 'innerWidth', { value: 800, writable: true, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 600, writable: true, configurable: true });
        window.dispatchEvent(new Event('resize'));

        expect(canvas.width).toBe(800);
        expect(canvas.height).toBe(600);
    });
});

describe('UnderwaterAmbience — theme switch (ROK-296)', () => {
    it('removes canvas when theme switches away from underwater', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        const { rerender } = render(<UnderwaterAmbience />);
        expect(document.querySelector('canvas')).toBeInTheDocument();

        mockResolvedTheme.mockReturnValue('default-dark');
        rerender(<UnderwaterAmbience />);

        expect(document.querySelector('canvas')).not.toBeInTheDocument();
    });

    it('renders canvas when theme switches to underwater', () => {
        mockResolvedTheme.mockReturnValue('default-dark');
        const { rerender } = render(<UnderwaterAmbience />);
        expect(document.querySelector('canvas')).not.toBeInTheDocument();

        mockResolvedTheme.mockReturnValue('underwater');
        rerender(<UnderwaterAmbience />);

        expect(document.querySelector('canvas')).toBeInTheDocument();
    });
});

describe('UnderwaterAmbience — reduced motion (ROK-296)', () => {
    // The component itself does not check prefers-reduced-motion internally;
    // Layout.tsx only renders UnderwaterAmbience when prefersMotion is true.
    // This suite tests the component's own behavior when rendered — it should
    // always draw, which is safe because the parent gates it behind prefersMotion.
    // We verify the canvas is present and animation loop starts (so parent can gate it).

    it('starts animation loop regardless of own render context (parent gates via prefersMotion)', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);
        // The canvas and animation loop should start — the Layout parent is
        // responsible for not rendering this when prefers-reduced-motion is set.
        expect(document.querySelector('canvas')).toBeInTheDocument();
        expect(rafCallbacks.size).toBeGreaterThan(0);
    });
});

describe('UnderwaterAmbience — draw calls on animation tick (ROK-296)', () => {
    it('calls clearRect on first animation frame tick', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);

        // Document is visible by default
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });

        flushRafOnce();

        expect(mockClearRect).toHaveBeenCalledWith(0, 0, expect.any(Number), expect.any(Number));
    });

    it('draws particles (arc) on first animation tick', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        flushRafOnce();

        expect(mockArc).toHaveBeenCalled();
    });

    it('re-queues requestAnimationFrame after each tick', () => {
        mockResolvedTheme.mockReturnValue('underwater');
        render(<UnderwaterAmbience />);

        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });

        const beforeCount = rafIdCounter;
        flushRafOnce();
        const afterCount = rafIdCounter;

        // A new rAF should have been requested
        expect(afterCount).toBeGreaterThan(beforeCount);
    });
});
