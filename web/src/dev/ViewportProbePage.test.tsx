import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportProbePage } from './ViewportProbePage';

const status = vi.hoisted(() => ({ demoMode: true, loading: false }));
vi.mock('../hooks/use-system-status', () => ({
    useSystemStatus: () => ({ data: status.loading ? undefined : { demoMode: status.demoMode }, isLoading: status.loading }),
}));

function renderProbe(search: string) {
    return render(
        <MemoryRouter initialEntries={[`/dev/viewport-probe${search}`]}>
            <Routes>
                <Route path="/dev/viewport-probe" element={<ViewportProbePage />} />
                <Route path="/" element={<p>home</p>} />
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
});

afterEach(() => {
    vi.restoreAllMocks();
    status.demoMode = true;
    status.loading = false;
});

function expectProbeChrome() {
    expect(screen.getByTestId('viewport-readout')).toHaveTextContent('vv.height');
    const marker = screen.getByTestId('viewport-probe-fixed-bottom');
    expect(marker).toHaveClass('fixed', 'bottom-0', 'inset-x-0');
    expect(marker).toHaveTextContent('FIXED BOTTOM');
    const end = screen.getByTestId('viewport-probe-end');
    expect(end).toHaveTextContent('END OF PAGE');
    expect(end).not.toHaveClass('fixed');
    expect(end).not.toHaveClass('absolute');
    expect(end.parentElement?.lastElementChild).toBe(end);
}

describe('ViewportProbePage (ROK-1661 DEMO-only bare probe)', () => {
    it('?mode=short: content is 1.1x the viewport, with the readout, fixed-bottom marker and in-flow end block', () => {
        renderProbe('?mode=short');
        expect(screen.getByTestId('viewport-probe-content').style.height).toBe('1100px');
        expect(screen.getByText(/mode short/)).toBeInTheDocument();
        expectProbeChrome();
    });

    it('?mode=tall: content is 3x the viewport, labelled every 250px', () => {
        renderProbe('?mode=tall');
        expect(screen.getByTestId('viewport-probe-content').style.height).toBe('3000px');
        expect(screen.getByText('y 2750')).toBeInTheDocument();
        expectProbeChrome();
    });

    it('defaults to short when mode is missing or unknown', () => {
        renderProbe('?mode=huge');
        expect(screen.getByTestId('viewport-probe-content').style.height).toBe('1100px');
    });

    it('outside DEMO_MODE redirects to / and renders no probe or readout', () => {
        status.demoMode = false;
        renderProbe('?mode=tall');
        expect(screen.getByText('home')).toBeInTheDocument();
        expect(screen.queryByTestId('viewport-readout')).toBeNull();
        expect(screen.queryByTestId('viewport-probe-fixed-bottom')).toBeNull();
    });

    it('renders nothing while the system status is loading', () => {
        status.loading = true;
        const { container } = renderProbe('?mode=short');
        expect(container).toBeEmptyDOMElement();
    });
});
