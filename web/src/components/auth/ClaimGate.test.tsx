import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { ClaimGate } from './ClaimGate';

const statusMock = vi.fn();
vi.mock('../../hooks/use-system-status', () => ({ useSystemStatus: () => statusMock() }));

function Probe(): JSX.Element {
    return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderAt(path: string): void {
    render(
        <MemoryRouter initialEntries={[path]}>
            <ClaimGate>
                <Routes><Route path="*" element={<Probe />} /></Routes>
            </ClaimGate>
        </MemoryRouter>,
    );
}

describe('ClaimGate', () => {
    beforeEach(() => statusMock.mockReset());

    it.each(['/', '/events', '/admin/setup', '/login'])('redirects %s to /claim while a claim is required', (path) => {
        statusMock.mockReturnValue({ data: { claimRequired: true } });
        renderAt(path);
        expect(screen.getByTestId('path').textContent).toBe('/claim');
    });

    it('stays on /claim while a claim is required', () => {
        statusMock.mockReturnValue({ data: { claimRequired: true } });
        renderAt('/claim');
        expect(screen.getByTestId('path').textContent).toBe('/claim');
    });

    it('sends /claim to / once nothing needs claiming (claimed or NAS)', () => {
        statusMock.mockReturnValue({ data: { claimRequired: false, flavour: 'nas' } });
        renderAt('/claim');
        expect(screen.getByTestId('path').textContent).toBe('/');
    });

    it('leaves other paths alone when no claim is required', () => {
        statusMock.mockReturnValue({ data: {} });
        renderAt('/events');
        expect(screen.getByTestId('path').textContent).toBe('/events');
    });

    it('renders children unchanged while status is loading', () => {
        statusMock.mockReturnValue({ data: undefined });
        renderAt('/claim');
        expect(screen.getByTestId('path').textContent).toBe('/claim');
    });
});
