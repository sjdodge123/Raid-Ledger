import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewportReadout } from './ViewportReadout';

const status = vi.hoisted(() => ({ demoMode: true }));
vi.mock('../hooks/use-system-status', () => ({ useSystemStatus: () => ({ data: status }) }));

function stubGeometry(scrollY: number, scrollHeight: number, innerHeight: number) {
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollY);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(innerHeight);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
}

afterEach(() => {
    vi.restoreAllMocks();
    status.demoMode = true;
});

describe('ViewportReadout (ROK-1661 diagnostic)', () => {
    it('shows the live viewport numbers in DEMO_MODE in the shell, not on the fixed layer, and nothing outside it', () => {
        const { unmount } = render(<ViewportReadout shellHeight={950} />);
        const panel = screen.getByTestId('viewport-readout');
        expect(panel).toHaveClass('absolute', 'bottom-20', 'right-2', 'pointer-events-none', 'font-mono');
        expect(panel).not.toHaveClass('fixed');
        for (const label of ['innerHeight', 'clientHeight', 'vv.height', 'vv.offsetTop', 'vv.pageTop', 'vv.scale',
            'scrollY', 'max scroll', 'scrollHeight', 'fixed probe bottom', 'shell minHeight', 'footer bottom',
            'html bg', 'body bg', 'orientation', 'icb − vv', 'activeElement', 'screen', 'visibility', 'last event']) {
            expect(panel).toHaveTextContent(label);
        }
        expect(panel).toHaveTextContent('950px');
        unmount();

        status.demoMode = false;
        render(<ViewportReadout shellHeight={950} />);
        expect(screen.queryByTestId('viewport-readout')).toBeNull();
    });

    it('shell minHeight reads off when the ?noshellfloor experiment has dropped the floor', () => {
        render(<ViewportReadout shellHeight={null} />);
        expect(screen.getByTestId('viewport-readout')).toHaveTextContent(/shell minHeight\s*off/);
    });

    it('last event starts at none and then names the most recent watched event', async () => {
        render(<ViewportReadout shellHeight={1048} />);
        const panel = screen.getByTestId('viewport-readout');
        expect(panel).toHaveTextContent(/last event\s*none/);
        window.dispatchEvent(new Event('pageshow'));
        await waitFor(() => expect(panel).toHaveTextContent(/last event\s*pageshow \d+ms ago/));
    });

    it('nudge pulls a scroll past the document end back to scrollHeight - innerHeight', () => {
        stubGeometry(1300, 1180, 1048);
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        render(<ViewportReadout shellHeight={1048} />);
        fireEvent.click(screen.getByRole('button', { name: 'nudge' }));
        expect(scrollTo).toHaveBeenCalledWith(window.scrollX, 132);
        expect(screen.getByTestId('viewport-readout')).toHaveTextContent(/max scroll\s*132/);
    });

    it('nudge leaves a scroll inside the document where it is', () => {
        stubGeometry(40, 1180, 1048);
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        render(<ViewportReadout shellHeight={1048} />);
        fireEvent.click(screen.getByRole('button', { name: 'nudge' }));
        expect(scrollTo).toHaveBeenCalledWith(window.scrollX, 40);
    });
});
