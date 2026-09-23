import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewportReadout } from './ViewportReadout';

const status = vi.hoisted(() => ({ demoMode: true }));
vi.mock('../hooks/use-system-status', () => ({ useSystemStatus: () => ({ data: status }) }));

describe('ViewportReadout (ROK-1661 diagnostic)', () => {
    it('shows the live viewport numbers in DEMO_MODE as a non-interactive overlay, and nothing outside it', () => {
        const { unmount } = render(<ViewportReadout shellHeight={950} />);
        const panel = screen.getByTestId('viewport-readout');
        expect(panel).toHaveClass('fixed', 'pointer-events-none', 'font-mono');
        for (const label of ['innerHeight', 'clientHeight', 'vv.height', 'vv.offsetTop', 'vv.scale', 'scrollY',
            'scrollHeight', 'shell minHeight', 'footer bottom', 'orientation']) {
            expect(panel).toHaveTextContent(label);
        }
        expect(panel).toHaveTextContent('950px');
        unmount();

        status.demoMode = false;
        render(<ViewportReadout shellHeight={950} />);
        expect(screen.queryByTestId('viewport-readout')).toBeNull();
    });
});
