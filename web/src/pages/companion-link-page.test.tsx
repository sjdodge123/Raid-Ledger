/** ROK-1955 T-WEB-1…4 — the `/link` device approval page. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { JSX } from 'react';
import { useLocation } from 'react-router-dom';
import type { CompanionLinkPreview } from '@raid-ledger/contract';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import { CompanionLinkPage } from './companion-link-page';
import { consumeAuthRedirect, saveAuthRedirect } from '../lib/auth-redirect';

const capture = vi.hoisted(() => ({ take: vi.fn((): string | null => null) }));
vi.mock('../lib/companion-link-code-capture', () => ({ takeCapturedLinkCode: capture.take }));

const API = 'http://localhost:3000';
const PREVIEW = `${API}/companion/v1/devices/link/preview`;
const DECISION = `${API}/companion/v1/devices/link/decision`;

function preview(over: Partial<CompanionLinkPreview> = {}): CompanionLinkPreview {
    const now = Date.now();
    return {
        userCode: 'BCDF-GHJK',
        device: { name: 'Gaming-PC', os: 'windows', osVersion: '11', appVersion: '0.1.0' },
        requestedAt: new Date(now - 2 * 60_000).toISOString(),
        expiresAt: new Date(now + 8 * 60_000).toISOString(),
        requestedNetwork: '203.0.113.x',
        sameNetworkAsYou: true,
        status: 'pending',
        ...over,
    };
}

interface Recorded { previews: unknown[]; decisions: unknown[] }

function mockApi(body: CompanionLinkPreview = preview()): Recorded {
    const rec: Recorded = { previews: [], decisions: [] };
    server.use(
        http.post(PREVIEW, async ({ request }) => { rec.previews.push(await request.json()); return HttpResponse.json(body); }),
        http.post(DECISION, async ({ request }) => {
            const req = (await request.json()) as { decision: string };
            rec.decisions.push(req);
            return HttpResponse.json({ status: req.decision === 'approve' ? 'approved' : 'denied' });
        }),
    );
    return rec;
}

function failWith(url: string, status: number, code: string): void {
    server.use(http.post(url, () => HttpResponse.json({ code, message: 'x' }, { status })));
}

/** Renders the router's current URL so a test can see the fragment go. */
function LocationProbe(): JSX.Element {
    const { pathname, search, hash } = useLocation();
    return <output data-testid="location">{`${pathname}${search}${hash}`}</output>;
}

function renderAt(entry: string): void {
    renderWithProviders(<><CompanionLinkPage /><LocationProbe /></>, { initialEntries: [entry] });
}

afterEach(() => { server.resetHandlers(); });

describe('CompanionLinkPage — entry and review', () => {
    it('T-WEB-1: entry form formats the code and Continue posts it to preview', async () => {
        const rec = mockApi();
        renderAt('/link');
        const input = screen.getByLabelText('Code shown on your computer');
        await userEvent.type(input, 'bcdfghjk');
        expect(input).toHaveValue('BCDF-GHJK');
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(rec.previews).toEqual([{ userCode: 'BCDFGHJK' }]);
    });

    it('T-WEB-1: an incomplete code is refused without a request', async () => {
        const rec = mockApi();
        renderAt('/link');
        await userEvent.type(screen.getByLabelText('Code shown on your computer'), 'bcd');
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(await screen.findByText(/check the 8 letters on your computer/)).toBeInTheDocument();
        expect(rec.previews).toHaveLength(0);
    });

    it('T-WEB-2: a #code= fragment prefills the review, but nothing is decided until Approve', async () => {
        const rec = mockApi();
        renderAt('/link#code=BCDF-GHJK');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(screen.getByLabelText('Device name')).toHaveValue('Gaming-PC');
        expect(screen.getByText('Windows 11 · Companion 0.1.0')).toBeInTheDocument();
        expect(screen.getByText(/Network 203\.0\.113\.x — the same network as you/)).toBeInTheDocument();
        expect(screen.getByText(/Never approve a code someone sent you\./)).toBeInTheDocument();
        expect(screen.getByText(/expires in 8 min/)).toBeInTheDocument();
        expect(rec.previews).toEqual([{ userCode: 'BCDFGHJK' }]);
        expect(rec.decisions).toHaveLength(0);
        expect(screen.queryByText(/A different network from yours/)).not.toBeInTheDocument();
    });

    it('T-WEB-2: ?code= prefill is honoured too', async () => {
        const rec = mockApi();
        renderAt('/link?code=BCDFGHJK');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(rec.decisions).toHaveLength(0);
    });

    it('Codex P2: a code captured (and stripped) at page load still prefills the review', async () => {
        const rec = mockApi();
        capture.take.mockReturnValueOnce('bcdfghjk');
        renderAt('/link');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(rec.previews).toEqual([{ userCode: 'BCDFGHJK' }]);
        expect(rec.decisions).toHaveLength(0);
    });

    it('T-WEB-3: a different-network preview shows the warning banner', async () => {
        mockApi(preview({ sameNetworkAsYou: false, requestedNetwork: '198.51.100.x' }));
        renderAt('/link#code=BCDFGHJK');
        expect(await screen.findByText('A different network from yours.')).toBeInTheDocument();
        expect(screen.getByText(/Network 198\.51\.100\.x — a different network from yours/)).toBeInTheDocument();
    });

});

describe('CompanionLinkPage — URL, expiry and focus (ROK-1955 web review)', () => {
    it('a #code= fragment is stripped from the URL once read (replace navigation)', async () => {
        mockApi();
        renderAt('/link#code=BCDF-GHJK');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/link$/);
    });

    it('a ?code= query is stripped from the URL once read', async () => {
        mockApi();
        renderAt('/link?code=BCDFGHJK');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(screen.getByTestId('location')).toHaveTextContent(/^\/link$/);
    });

    it('a client clock past expiresAt keeps Approve with a soft hint; the server decides', async () => {
        const rec = mockApi(preview({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
        renderAt('/link#code=BCDFGHJK');
        expect(await screen.findByText(/This code may have expired\./)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
        expect(await screen.findByText(/Return to your computer/)).toBeInTheDocument();
        expect(rec.decisions).toEqual([{ userCode: 'BCDFGHJK', decision: 'approve' }]);
    });

    it('a code inside its lifetime shows no expiry hint', async () => {
        mockApi();
        renderAt('/link#code=BCDFGHJK');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(screen.queryByText(/may have expired/)).not.toBeInTheDocument();
    });

    it('focus moves to the new step heading on Continue and on Approve', async () => {
        mockApi();
        renderAt('/link');
        await userEvent.type(screen.getByLabelText('Code shown on your computer'), 'bcdfghjk');
        await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
        const review = await screen.findByRole('heading', { name: 'Link this computer to your account?' });
        await waitFor(() => expect(review).toHaveFocus());
        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await screen.findByText(/Return to your computer/);
        await waitFor(() => expect(screen.getByRole('heading', { name: 'Link a computer' })).toHaveFocus());
    });

});

describe('CompanionLinkPage — decisions and errors', () => {
    it('T-WEB-4: Approve sends the decision and shows the approved state', async () => {
        const rec = mockApi();
        renderAt('/link#code=BCDFGHJK');
        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        expect(await screen.findByText(/Return to your computer/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Manage devices' })).toHaveAttribute('href', '/profile/integrations#companion-devices');
        expect(rec.decisions).toEqual([{ userCode: 'BCDFGHJK', decision: 'approve' }]);
    });

    it('T-WEB-4: a renamed device is approved with the new name', async () => {
        const rec = mockApi();
        renderAt('/link#code=BCDFGHJK');
        const name = await screen.findByLabelText('Device name');
        await userEvent.clear(name);
        await userEvent.type(name, 'Desk PC');
        await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
        await screen.findByText(/Return to your computer/);
        expect(rec.decisions).toEqual([{ userCode: 'BCDFGHJK', decision: 'approve', name: 'Desk PC' }]);
    });

    it('T-WEB-4: Deny shows the denied state', async () => {
        const rec = mockApi();
        renderAt('/link#code=BCDFGHJK');
        await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
        expect(await screen.findByText(/that computer will not be linked/)).toBeInTheDocument();
        expect(rec.decisions).toEqual([{ userCode: 'BCDFGHJK', decision: 'deny' }]);
    });

    it('T-WEB-4: a 404 preview shows the invalid/expired copy on the code field', async () => {
        failWith(PREVIEW, 404, 'code_not_found');
        renderAt('/link#code=BCDFGHJK');
        expect(await screen.findByText("That code isn't valid or has expired. Start again on your computer.")).toBeInTheDocument();
        expect(screen.getByLabelText('Code shown on your computer')).toHaveValue('BCDF-GHJK');
    });

    it('T-WEB-4: a 429 preview shows the rate-limit copy', async () => {
        failWith(PREVIEW, 429, 'rate_limited');
        renderAt('/link#code=BCDFGHJK');
        expect(await screen.findByText('Too many tries. Wait a few minutes and try again.')).toBeInTheDocument();
    });

    it('T-WEB-4: a 409 device_limit on Approve shows the limit copy with a Devices link', async () => {
        mockApi();
        failWith(DECISION, 409, 'device_limit');
        renderAt('/link#code=BCDFGHJK');
        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        expect(await screen.findByText(/You have 10 linked devices\. Remove one to link another\./)).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('link', { name: 'Manage devices' })).toHaveAttribute('href', '/profile/integrations#companion-devices'));
    });

    it('T-WEB-4: a 404 on Approve shows the invalid/expired copy', async () => {
        mockApi();
        failWith(DECISION, 404, 'code_not_found');
        renderAt('/link#code=BCDFGHJK');
        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        expect(await screen.findByText("That code isn't valid or has expired. Start again on your computer.")).toBeInTheDocument();
    });
});

describe('CompanionLinkPage — restart after a dead code (ROK-1955 review)', () => {
    it('a 404 on Approve offers "Enter a new code", which returns to an empty, focused entry step', async () => {
        const rec = mockApi();
        failWith(DECISION, 404, 'code_not_found');
        renderAt('/link#code=BCDFGHJK');
        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        await userEvent.click(await screen.findByRole('button', { name: 'Enter a new code' }));
        const heading = await screen.findByRole('heading', { name: 'Link a computer' });
        await waitFor(() => expect(heading).toHaveFocus());
        expect(screen.getByLabelText('Code shown on your computer')).toHaveValue('');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(rec.previews).toHaveLength(1);
    });

    it('a decision error other than 404 does not offer "Enter a new code"', async () => {
        mockApi();
        failWith(DECISION, 409, 'device_limit');
        renderAt('/link#code=BCDFGHJK');
        await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
        await screen.findByText(/You have 10 linked devices/);
        expect(screen.queryByRole('button', { name: 'Enter a new code' })).not.toBeInTheDocument();
    });
});

describe('CompanionLinkPage — after sign-in (ROK-1955 review)', () => {
    it('review fix: the post-sign-in return path AuthGuard saved (/link#code=…) prefills the review', async () => {
        const rec = mockApi();
        saveAuthRedirect('/link#code=BCDF-GHJK');
        const back = consumeAuthRedirect();
        expect(back).toBe('/link#code=BCDF-GHJK');
        renderAt(back ?? '/link');
        expect(await screen.findByText('Link this computer to your account?')).toBeInTheDocument();
        expect(rec.previews).toEqual([{ userCode: 'BCDFGHJK' }]);
        expect(rec.decisions).toHaveLength(0);
    });
});
