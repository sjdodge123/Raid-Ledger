import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    SchedulingBetterTimeSheet,
    SchedulingBetterTimeTrigger,
} from '../SchedulingBetterTimeSheet';

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('SchedulingBetterTimeSheet (mobile)', () => {
    it('mounts nothing while closed, so no Close button sits in the tab order', () => {
        stubViewport(false);
        render(
            <SchedulingBetterTimeSheet isOpen={false} onClose={() => {}}>
                <div>grid</div>
            </SchedulingBetterTimeSheet>,
        );
        expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
        expect(screen.queryByTestId('scheduling-better-time-body')).toBeNull();
    });

    it('renders the sheet with its body once opened', () => {
        stubViewport(false);
        render(
            <SchedulingBetterTimeSheet isOpen onClose={() => {}}>
                <div>grid</div>
            </SchedulingBetterTimeSheet>,
        );
        expect(
            screen.getByTestId('scheduling-better-time-body'),
        ).toHaveAttribute('data-surface', 'sheet');
        expect(
            screen.getByRole('button', { name: /close/i }),
        ).toBeInTheDocument();
    });
});

/**
 * ROK-1580 — on a phone the sheet is the frame-2 drawer: a DEFINITE body height
 * (the group module stretches its hour rows into it and never scrolls inside),
 * the suggest form pinned under it, and no intro paragraph — the module's own
 * legend carries that meaning and the sheet has no room for prose.
 */
describe('SchedulingBetterTimeSheet layout (ROK-1580)', () => {
    /** The body element, which owns the whole phone layout. */
    function renderBody(desktop: boolean): HTMLElement {
        stubViewport(desktop);
        render(
            <SchedulingBetterTimeSheet isOpen onClose={() => {}}>
                <div>module</div>
                <div>suggest form</div>
            </SchedulingBetterTimeSheet>,
        );
        return screen.getByTestId('scheduling-better-time-body');
    }

    it('gives the phone body a definite height and a column layout', () => {
        const classes = renderBody(false).className.split(/\s+/);
        expect(classes).toContain('h-[calc(var(--sheet-vh,1dvh)_*_95_-_200px)]');
        expect(classes).toContain('min-h-0');
        expect(classes).toContain('flex-col');
        // The module takes the slack; the suggest form keeps its own height.
        expect(classes).toContain('[&>*:first-child]:flex-1');
        expect(classes).toContain('[&>*:last-child]:flex-none');
    });

    it('has no intro paragraph on either viewport (ROK-1588: the legends carry it)', () => {
        expect(renderBody(false)).not.toHaveTextContent(/proposing counts as your vote/i);
        cleanup();
        expect(renderBody(true)).not.toHaveTextContent(/proposing counts as your vote/i);
    });

    it('widens the desktop modal to max-w-5xl for seven readable day columns (ROK-1588)', () => {
        renderBody(true);
        expect(document.querySelector('.max-w-5xl')).not.toBeNull();
        expect(document.querySelector('.max-w-3xl')).toBeNull();
    });
});

/**
 * The trigger is the poll's one way out when no offered time suits. ROK-1546
 * AC6 made it a solid button on phones (the dashed, muted ghost was nearly
 * invisible on a device); the operator then asked (2026-11-23) for a colour
 * that stands out, so at every width it is the shared `Button` in its
 * `warning-soft` variant.
 */
describe('SchedulingBetterTimeTrigger', () => {
    /** The trigger element, which owns the whole treatment. */
    function renderTrigger(): HTMLElement {
        render(<SchedulingBetterTimeTrigger onClick={() => {}} />);
        return screen.getByTestId('scheduling-find-better-time');
    }

    it('is a full-width tinted button with a 44px touch target', () => {
        const classes = renderTrigger().className.split(/\s+/);
        expect(classes).toContain('bg-warning/10');
        expect(classes).toContain('border-warning/30');
        expect(classes).toContain('text-warning');
        expect(classes).toContain('w-full');
        expect(classes).toContain('min-h-[44px]');
    });

    it('carries the same tint at every width (no muted or dashed look from lg up)', () => {
        const classes = renderTrigger().className.split(/\s+/);
        expect(classes).not.toContain('border-dashed');
        expect(classes).not.toContain('lg:border-dashed');
        expect(classes).not.toContain('lg:text-secondary');
        expect(classes).not.toContain('lg:bg-transparent');
    });

    it('keeps the copy and renders the leading + as a decorative glyph', () => {
        const trigger = renderTrigger();
        expect(trigger).toHaveTextContent(
            'None of these work — find a better time',
        );
        expect(trigger.querySelector('[aria-hidden="true"]')).toHaveTextContent(
            '+',
        );
    });
});
