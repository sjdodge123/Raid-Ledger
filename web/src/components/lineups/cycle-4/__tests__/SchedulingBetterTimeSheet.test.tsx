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
        expect(classes).toContain('h-[calc(95dvh-200px)]');
        expect(classes).toContain('min-h-0');
        expect(classes).toContain('flex-col');
        // The module takes the slack; the suggest form keeps its own height.
        expect(classes).toContain('[&>*:first-child]:flex-1');
        expect(classes).toContain('[&>*:last-child]:flex-none');
    });

    it('drops the intro paragraph on a phone and keeps it on the desktop', () => {
        expect(renderBody(false)).not.toHaveTextContent(/proposing counts as your vote/i);
        cleanup();
        expect(renderBody(true)).toHaveTextContent(/proposing counts as your vote/i);
    });
});

/**
 * ROK-1546 AC6 — on a phone the trigger is the ladder's SECOND action, not a
 * ghost. The dashed, muted treatment was nearly invisible against the panel on
 * an actual device (operator screenshot), so below `sm` it borrows the same
 * secondary-button recipe the sign-in CTA in `SchedulingSlotRow` uses
 * (`border-edge-strong` + `bg-surface` + `text-foreground`). The dashed/muted
 * look survives from `sm` up, where it never had the contrast problem.
 */
describe('SchedulingBetterTimeTrigger (ROK-1546 AC6)', () => {
    /** The trigger element, which owns the whole mobile treatment. */
    function renderTrigger(): HTMLElement {
        render(<SchedulingBetterTimeTrigger onClick={() => {}} />);
        return screen.getByTestId('scheduling-find-better-time');
    }

    it('reads as a solid secondary button below lg', () => {
        const classes = renderTrigger().className.split(/\s+/);
        expect(classes).toContain('border-edge-strong');
        expect(classes).toContain('bg-surface');
        expect(classes).toContain('text-foreground');
        expect(classes).toContain('w-full');
        expect(classes).toContain('min-h-[44px]');
    });

    it('keeps the dashed/muted treatment for lg and up only', () => {
        const classes = renderTrigger().className.split(/\s+/);
        // A BARE `border-dashed` would apply on the phone too — that is the bug.
        expect(classes).not.toContain('border-dashed');
        expect(classes).toContain('lg:border-dashed');
        expect(classes).not.toContain('text-secondary');
        expect(classes).toContain('lg:text-secondary');
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
