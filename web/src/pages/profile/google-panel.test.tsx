/**
 * ROK-2371: Profile → Integrations Google sign-in panel and the shared
 * Unlink control — unlinked, linked, last-method disabled, and the 409 copy
 * when the server refuses anyway.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { SigninMethodsDto } from '@raid-ledger/contract';
import { GoogleSigninPanel } from './google-panel';
import { SigninUnlinkButton } from './signin-unlink-button';
import { unlinkDiscord, unlinkGoogle } from '../../lib/api/users-api';
import { withErrorBody, withHttpStatus } from '../../lib/api/api-error';

const start = vi.fn();
vi.mock('../../hooks/use-link-start', () => ({ useLinkStart: () => ({ start, isPending: false }) }));
vi.mock('../../lib/api/users-api', () => ({ unlinkGoogle: vi.fn(), unlinkDiscord: vi.fn() }));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const COPY = 'Add another way to sign in first';
const GOOGLE = { email: 'ana@example.com', linkedAt: '2026-11-20T10:00:00.000Z' };
const methods = (over: Partial<SigninMethodsDto>): SigninMethodsDto => ({ discord: false, google: null, password: false, ...over });

function renderUi(ui: ReactElement) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('GoogleSigninPanel', () => {
    it('unlinked + Google sign-in on: "Link Google" starts the link flow', async () => {
        renderUi(<GoogleSigninPanel methods={methods({ discord: true })} googleAvailable />);
        await userEvent.click(screen.getByRole('button', { name: 'Link Google' }));
        expect(start).toHaveBeenCalledTimes(1);
        expect(start).toHaveBeenCalledWith();
    });

    it('unlinked + Google sign-in off: renders nothing', () => {
        const { container } = renderUi(<GoogleSigninPanel methods={methods({ discord: true })} googleAvailable={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('linked: shows "Linked as <email>" and an enabled Unlink that calls the API', async () => {
        vi.mocked(unlinkGoogle).mockResolvedValue(undefined);
        renderUi(<GoogleSigninPanel methods={methods({ discord: true, google: GOOGLE })} googleAvailable={false} />);
        expect(screen.getByText('Linked as ana@example.com')).toBeInTheDocument();
        const unlink = screen.getByRole('button', { name: 'Unlink Google' });
        expect(unlink).toBeEnabled();
        expect(screen.queryByText(COPY)).toBeNull();
        await userEvent.click(unlink);
        await waitFor(() => expect(unlinkGoogle).toHaveBeenCalledTimes(1));
    });

    it('Google is the last method: Unlink is disabled with the 409 copy', () => {
        renderUi(<GoogleSigninPanel methods={methods({ google: GOOGLE })} googleAvailable />);
        const unlink = screen.getByRole('button', { name: 'Unlink Google' });
        expect(unlink).toBeDisabled();
        expect(unlink).toHaveAccessibleDescription(COPY);
    });

    it('a 409 LAST_SIGNIN_METHOD that comes back anyway shows the copy inline', async () => {
        const refusal = withErrorBody(withHttpStatus(new Error('Add another way to sign in first'), 409),
            { statusCode: 409, code: 'LAST_SIGNIN_METHOD', message: COPY });
        vi.mocked(unlinkGoogle).mockRejectedValue(refusal);
        renderUi(<GoogleSigninPanel methods={methods({ discord: true, google: GOOGLE })} googleAvailable />);
        await userEvent.click(screen.getByRole('button', { name: 'Unlink Google' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(COPY);
    });
});

describe('SigninUnlinkButton — Discord', () => {
    it('a Discord-only account cannot unlink Discord (refused too)', () => {
        renderUi(<SigninUnlinkButton method="discord" methods={methods({ discord: true })} />);
        expect(screen.getByRole('button', { name: 'Unlink Discord' })).toBeDisabled();
        expect(screen.getByText(COPY)).toBeInTheDocument();
    });

    it('Discord + Google: Unlink Discord is enabled and calls the API', async () => {
        vi.mocked(unlinkDiscord).mockResolvedValue(undefined);
        renderUi(<SigninUnlinkButton method="discord" methods={methods({ discord: true, google: GOOGLE })} />);
        await userEvent.click(screen.getByRole('button', { name: 'Unlink Discord' }));
        await waitFor(() => expect(unlinkDiscord).toHaveBeenCalledTimes(1));
    });
});
