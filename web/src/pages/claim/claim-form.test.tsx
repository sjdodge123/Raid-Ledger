import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { ClaimForm } from './claim-form';

const fetchMock = vi.fn();
vi.mock('../../lib/api/native-fetch', () => ({ nativeFetch: (...a: unknown[]) => fetchMock(...a) }));
const loginMock = vi.fn();
vi.mock('../../hooks/use-auth', () => ({ useAuth: () => ({ login: loginMock }) }));

const GOOD_PW = 'correct horse battery';
const respond = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

async function fill(code: string, pw = GOOD_PW, confirm = pw): Promise<void> {
    const user = userEvent.setup();
    if (code) await user.type(screen.getByLabelText('Setup code'), code);
    if (pw) await user.type(screen.getByLabelText('New password'), pw);
    if (confirm) await user.type(screen.getByLabelText('Confirm password'), confirm);
    await user.click(screen.getByRole('button', { name: 'Claim and set password' }));
}

const TOO_LONG_PW = 'é'.repeat(37); // 37 chars, 74 UTF-8 bytes

beforeEach(() => { fetchMock.mockReset(); loginMock.mockReset(); });

describe('ClaimForm — fields and client guards', () => {
    it('shows the idle hint and the fixed sign-in name', () => {
        renderWithProviders(<ClaimForm />);
        expect(screen.getByText(/Paste the whole value/)).toBeInTheDocument();
        expect(screen.getByLabelText('Sign-in name')).toHaveValue('admin@local');
        expect(screen.getByLabelText('Sign-in name')).toHaveAttribute('readonly');
    });

    it('refuses an empty code without calling the server', async () => {
        renderWithProviders(<ClaimForm />);
        await fill('');
        expect(screen.getByRole('alert')).toHaveTextContent('Enter your setup code first.');
        expect(screen.getByLabelText('Setup code')).toHaveAttribute('aria-invalid', 'true');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a short or mismatched password client-side', async () => {
        renderWithProviders(<ClaimForm />);
        await fill('ABCD-EFGH', 'short', 'shorter');
        expect(screen.getByText("The two passwords don't match.")).toBeInTheDocument();
        expect(screen.getByText(/Choose a password of at least 12 characters/)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('one Show passwords checkbox reveals both password fields', async () => {
        renderWithProviders(<ClaimForm />);
        expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'password');
        await userEvent.setup().click(screen.getByLabelText('Show passwords'));
        expect(screen.getByLabelText('New password')).toHaveAttribute('type', 'text');
        expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
    });

    it('grades the password by length', async () => {
        renderWithProviders(<ClaimForm />);
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('New password'), 'abcde');
        expect(screen.getByText('Too short.')).toBeInTheDocument();
        await user.type(screen.getByLabelText('New password'), 'fghij');
        expect(screen.getByText('Nearly there: 12 characters or more.')).toBeInTheDocument();
        await user.type(screen.getByLabelText('New password'), 'kl');
        expect(screen.getByText('Strong enough.')).toBeInTheDocument();
    });

    it('refuses a password past 72 bytes on the password field, not the code field', async () => {
        renderWithProviders(<ClaimForm />);
        await fill('ABCD-EFGH', TOO_LONG_PW);
        const pw = screen.getByLabelText('New password');
        expect(screen.getByText(/That password is too long/)).toBeInTheDocument();
        expect(screen.getByText(/^Too long/)).toBeInTheDocument();
        expect(pw).toHaveFocus();
        expect(pw).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Setup code')).not.toHaveAttribute('aria-invalid');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('a matching confirm is not painted success while the password is invalid', async () => {
        renderWithProviders(<ClaimForm />);
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('New password'), 'short');
        await user.type(screen.getByLabelText('Confirm password'), 'short');
        expect(screen.getByLabelText('Confirm password')).not.toHaveAttribute('data-success', 'true');
    });
});

describe('ClaimForm — server results', () => {
    it.each([
        [401, { code: 'claim_code_invalid', message: 'x' }, "That code doesn't match."],
        [410, { code: 'claim_expired', message: 'x' }, 'This code has expired. Restart the service for a new code.'],
        [429, { code: 'claim_locked', message: 'x', retryAt: '2026-10-30T13:05:00.000Z' }, 'Too many wrong codes.'],
        [403, { code: 'claim_https_required', message: 'x' }, 'Open this page over https:// to claim it.'],
        [500, { message: 'boom' }, 'Something went wrong. Try again.'],
    ])('a %d refusal shows its own message', async (status, body, text) => {
        fetchMock.mockResolvedValue(respond(status, body));
        renderWithProviders(<ClaimForm />);
        await fill('WRONG-CODE');
        expect(await screen.findByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(loginMock).not.toHaveBeenCalled();
    });

    it('posts the code in the body only, signs in and offers Continue to setup', async () => {
        fetchMock.mockResolvedValue(respond(200, { access_token: 'jwt-1', user: { id: 1 } }));
        loginMock.mockResolvedValue({ id: 1 });
        const { queryClient } = renderWithProviders(<ClaimForm />);
        queryClient.setQueryData(['system', 'status'], { claimRequired: true });
        await fill('MY-SECRET-CODE');
        expect(await screen.findByText('Code accepted. This Raid Ledger is yours.')).toBeInTheDocument();
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toMatch(/\/setup\/claim$/);
        expect(String(url)).not.toContain('MY-SECRET-CODE');
        expect(JSON.parse(String(init?.body))).toEqual({ code: 'MY-SECRET-CODE', newPassword: GOOD_PW });
        expect(loginMock).toHaveBeenCalledWith('jwt-1');
        expect(screen.queryByRole('button', { name: 'Claim and set password' })).not.toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Continue to setup' });
        expect(link).toHaveAttribute('href', '/admin/setup');
        await userEvent.setup().click(link);
        await waitFor(() => expect(queryClient.getQueryData(['system', 'status'])).toMatchObject({ claimRequired: false }));
    });

    it('a server 400 lands on the password field, not under the setup code', async () => {
        fetchMock.mockResolvedValue(respond(400, { message: 'A setup code and a password of at least 12 characters are required.' }));
        renderWithProviders(<ClaimForm />);
        await fill('MY-SECRET-CODE');
        const pw = screen.getByLabelText('New password');
        await waitFor(() => expect(pw).toHaveFocus());
        expect(pw).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Setup code')).not.toHaveAttribute('aria-invalid');
    });
});

describe('ClaimForm — focus and success', () => {
    it('focuses the code field on an empty submit', async () => {
        renderWithProviders(<ClaimForm />);
        await fill('');
        expect(screen.getByLabelText('Setup code')).toHaveFocus();
    });

    it('focuses the code field after a wrong code', async () => {
        fetchMock.mockResolvedValue(respond(401, { code: 'claim_code_invalid', message: 'x' }));
        renderWithProviders(<ClaimForm />);
        await fill('WRONG-CODE');
        await screen.findByText(/That code doesn't match/);
        expect(screen.getByLabelText('Setup code')).toHaveFocus();
    });

    it('password refusal: linked to New password, focused, cleared on edit', async () => {
        renderWithProviders(<ClaimForm />);
        await fill('ABCD-EFGH', 'short', 'short');
        const pw = screen.getByLabelText('New password');
        const alert = screen.getByText(/Choose a password of at least 12 characters/);
        expect(pw).toHaveFocus();
        expect(pw).toHaveAttribute('aria-invalid', 'true');
        expect(pw.getAttribute('aria-describedby')).toContain(alert.id);
        await userEvent.setup().type(pw, 'x');
        expect(screen.queryByText(/Choose a password of at least 12 characters/)).not.toBeInTheDocument();
        expect(pw).not.toHaveAttribute('aria-invalid');
    });

    it('locked shows its warning without marking the code invalid', async () => {
        fetchMock.mockResolvedValue(respond(429, { code: 'claim_locked', message: 'x', retryAt: '2026-10-30T13:05:00.000Z' }));
        renderWithProviders(<ClaimForm />);
        await fill('WRONG-CODE');
        await screen.findByText(/Too many wrong codes/);
        expect(screen.getByTestId('claim-code-message')).toHaveClass('text-warning');
        expect(screen.getByTestId('claim-code-message').querySelector('[aria-hidden="true"]')?.textContent).toBe('\u26A0\uFE0E');
        expect(screen.getByLabelText('Setup code')).not.toHaveAttribute('aria-invalid');
    });

    it('ok paints the code field success; matching confirm too', async () => {
        fetchMock.mockResolvedValue(respond(200, { access_token: 'jwt-1' }));
        loginMock.mockResolvedValue({ id: 1 });
        renderWithProviders(<ClaimForm />);
        await fill('MY-SECRET-CODE');
        await screen.findByText('Code accepted. This Raid Ledger is yours.');
        expect(screen.getByLabelText('Setup code')).toHaveAttribute('data-success', 'true');
        expect(screen.getByLabelText('Confirm password')).toHaveAttribute('data-success', 'true');
    });

    it('a failed sign-in after the claim sends Continue to /login', async () => {
        fetchMock.mockResolvedValue(respond(200, { access_token: 'jwt-1' }));
        loginMock.mockResolvedValue(null);
        renderWithProviders(<ClaimForm />);
        await fill('MY-SECRET-CODE');
        const link = await screen.findByRole('link', { name: 'Sign in to continue' });
        expect(link).toHaveAttribute('href', '/login');
    });

    it('shows the expired state on load when the code already lapsed', () => {
        renderWithProviders(<ClaimForm expiredOnLoad />);
        expect(screen.getByRole('alert')).toHaveTextContent('This code has expired.');
    });
});
