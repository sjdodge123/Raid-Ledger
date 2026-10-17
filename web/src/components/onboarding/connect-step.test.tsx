import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConnectStep } from './connect-step';

// fetch-api captures `window.fetch` at module init (ROK-1754 §3.6), so the
// stub must be in place before it is imported. Unconfigured, it delegates to
// the MSW-patched fetch the other tests already hit.
const fetchMock = vi.hoisted(() => {
    const original = globalThis.fetch;
    const fn = vi.fn((...args: unknown[]) => (original as (...a: unknown[]) => unknown)(...args));
    vi.stubGlobal('fetch', fn);
    return fn;
});

vi.mock('../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../icons/DiscordIcon', () => ({
    DiscordIcon: ({ className }: { className?: string }) => (
        <svg data-testid="discord-icon" className={className} />
    ),
}));

function connectstepGroup1() {
it('renders the Connect Your Account heading', () => {
        render(<ConnectStep />);
        expect(screen.getByText(/connect your account/i)).toBeInTheDocument();
    });

it('renders the Discord connect button', () => {
        render(<ConnectStep />);
        expect(screen.getByRole('button', { name: /connect discord/i })).toBeInTheDocument();
    });

it('Discord button is not disabled by default', () => {
        render(<ConnectStep />);
        const button = screen.getByRole('button', { name: /connect discord/i });
        expect(button).not.toBeDisabled();
    });

it('shows redirecting state when button is clicked', () => {
        render(<ConnectStep />);
        const button = screen.getByRole('button', { name: /connect discord/i });
        fireEvent.click(button);
        expect(screen.getByText(/redirecting to discord/i)).toBeInTheDocument();
    });

}

function connectstepGroup2() {
it('disables button while redirecting', () => {
        render(<ConnectStep />);
        const button = screen.getByRole('button', { name: /connect discord/i });
        fireEvent.click(button);
        expect(button).toBeDisabled();
    });

it('renders informational text about linking accounts later', () => {
        render(<ConnectStep />);
        expect(screen.getByText(/link accounts later/i)).toBeInTheDocument();
    });

it('renders the Discord icon in the button', () => {
        render(<ConnectStep />);
        expect(screen.getByTestId('discord-icon')).toBeInTheDocument();
    });

}

describe('ConnectStep', () => {
beforeEach(() => {
        vi.clearAllMocks();
    });

    connectstepGroup1();
    connectstepGroup2();
});

describe('ConnectStep Discord link start (ROK-1630 AC16)', () => {
    it('clicking POSTs /auth/discord/link/start (not a bare GET) and re-enables the button after a 401', async () => {
        // mockReset also drops the earlier tests' clicks, so only this click counts.
        fetchMock.mockReset();
        const fetchFn = fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
        try {
            render(<ConnectStep />);
            fireEvent.click(screen.getByRole('button', { name: /connect discord/i }));
            await waitFor(() => expect(fetchFn).toHaveBeenCalledWith(
                'http://localhost:3000/auth/discord/link/start',
                expect.objectContaining({ method: 'POST' }),
            ));
            await waitFor(() => expect(screen.getByRole('button', { name: /connect discord/i })).not.toBeDisabled());
        } finally {
            fetchMock.mockReset();
        }
    });
});
