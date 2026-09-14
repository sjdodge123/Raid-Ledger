import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchedulingBetterTimeSheet } from '../SchedulingBetterTimeSheet';

/** Force `useMediaQuery('(min-width: 768px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('768'),
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
