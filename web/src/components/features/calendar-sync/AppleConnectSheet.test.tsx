/**
 * K3 Apple connect sheet (ROK-1598 L5a) against MSW: opened from the K1 row,
 * Modal on desktop / BottomSheet on phone, client validation, every refusal,
 * the throttle, reconnect prefill, the dirty-close confirm, and the password
 * never outliving the sheet (state or mutation cache).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { axe } from 'vitest-axe';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient } from '../../../test/render-helpers';
import {
    APPLE_PASSWORD_DOWN, APPLE_PASSWORD_FAIL, appleConnectThrottledHandler, userCalendarHandlers,
} from '../../../test/mocks/calendar-sync-handlers';
import { buildAppleConnection } from '../../../test/factories/calendar-sync';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { CALENDARS_OVERVIEW_KEY } from '../../../hooks/use-calendar-sync';
import { AppleProviderRow } from './AppleProviderRow';
import { AppleConnectSheet } from './AppleConnectSheet';
import { APPLE_APP_PASSWORD_HELP_URL, APPLE_CONNECT_COPY as A, APPLE_CONNECT_ERROR_COPY as E } from './apple-connect.copy';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const EMAIL = 'raider@icloud.com';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const realMatchMedia = window.matchMedia;
const realOffsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
let applePosts = 0;

function setDesktop(desktop: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true, writable: true,
        value: (query: string) => ({
            matches: query === DESKTOP_MQ ? desktop : false, media: query, onchange: null,
            addEventListener: () => {}, removeEventListener: () => {},
            addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
        }),
    });
}

function renderRow(available = true): { queryClient: QueryClient; container: HTMLElement } {
    const queryClient = createTestQueryClient();
    const { container } = render(
        <QueryClientProvider client={queryClient}><AppleProviderRow available={available} /></QueryClientProvider>,
    );
    return { queryClient, container };
}

async function openSheet(user: UserEvent): Promise<HTMLElement> {
    await user.click(screen.getByTestId('calendar-connect-apple'));
    return screen.findByRole('dialog', { name: A.titleConnect });
}

async function fill(user: UserEvent, email: string, password: string): Promise<void> {
    if (email) await user.type(screen.getByLabelText(A.emailLabel, { exact: false }), email);
    if (password) await user.type(screen.getByLabelText(A.passwordLabel, { exact: false, selector: 'input' }), password);
}

const emailInput = () => screen.getByLabelText<HTMLInputElement>(A.emailLabel, { exact: false });
const passwordInput = () => screen.getByLabelText<HTMLInputElement>(A.passwordLabel, { exact: false, selector: 'input' });
const passwordInCache = (qc: QueryClient) =>
    qc.getMutationCache().getAll().some((m) => JSON.stringify(m.state.variables ?? null).includes(PASSWORD));

beforeEach(() => {
    setDesktop(true);
    // jsdom reports offsetParent null for everything, so the focus trap would see nothing focusable.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true, get(this: HTMLElement) { return this.parentNode; },
    });
    applePosts = 0;
    server.use(...userCalendarHandlers());
    server.events.on('request:start', ({ request }) => {
        if (request.method === 'POST' && request.url.endsWith('/users/me/calendars/apple')) applePosts += 1;
    });
});

afterEach(() => {
    server.events.removeAllListeners();
    if (realOffsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', realOffsetParent);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia });
    vi.clearAllMocks();
});

describe('AppleConnectSheet — shell', () => {
    it('opens from the K1 row as a Modal at desktop', async () => {
        const user = userEvent.setup();
        renderRow();
        const dialog = await openSheet(user);
        expect(within(dialog).getByTestId('apple-connect-form')).toBeInTheDocument();
        expect(screen.getByTestId('modal-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('bottom-sheet-footer')).not.toBeInTheDocument();
    });

    it('opens as a BottomSheet below 1024px', async () => {
        setDesktop(false);
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        expect(screen.getByTestId('bottom-sheet-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('modal-footer')).not.toBeInTheDocument();
    });

    it('links Apple’s app-specific-password article in a new tab', async () => {
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        const link = screen.getByTestId('apple-connect-help-link');
        expect(link).toHaveAttribute('href', APPLE_APP_PASSWORD_HELP_URL);
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(screen.getByText(A.twoFactor)).toBeInTheDocument();
    });

    it('labels both fields, keeps password managers off the password, and is axe clean', async () => {
        const user = userEvent.setup();
        renderRow();
        const dialog = await openSheet(user);
        expect(emailInput()).toHaveAttribute('type', 'email');
        expect(emailInput()).toHaveAttribute('autocomplete', 'username');
        expect(passwordInput()).toHaveAttribute('type', 'password');
        expect(passwordInput()).toHaveAttribute('autocomplete', 'off');
        expect(passwordInput()).toHaveAttribute('data-1p-ignore');
        expect(passwordInput()).toHaveAttribute('data-lpignore', 'true');
        expect(await axe(dialog)).toHaveNoViolations();
    });

    it('traps focus inside the dialog and closes a clean sheet on Escape', async () => {
        const user = userEvent.setup();
        renderRow();
        const dialog = await openSheet(user);
        for (let i = 0; i < 8; i += 1) {
            await user.tab();
            expect(dialog.contains(document.activeElement)).toBe(true);
        }
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});

describe('AppleConnectSheet — submit', () => {
    it('a malformed password shows the inline format error, keeps Connect disabled and sends nothing', async () => {
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        await fill(user, EMAIL, 'not-a-password');
        await user.tab();
        expect(screen.getByText(A.passwordInvalid)).toBeInTheDocument();
        expect(screen.getByTestId('apple-connect-submit')).toBeDisabled();
        await user.type(passwordInput(), '{Enter}');
        expect(applePosts).toBe(0);
    });

    it('connects: 201 → toast, sheet closes, overview invalidated, password gone from the cache', async () => {
        const user = userEvent.setup();
        const { queryClient } = renderRow();
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        await openSheet(user);
        await fill(user, EMAIL, PASSWORD);
        await user.click(screen.getByTestId('apple-connect-submit'));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith(A.toastConnected));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(applePosts).toBe(1);
        expect(invalidate).toHaveBeenCalledWith({ queryKey: [...CALENDARS_OVERVIEW_KEY] });
        await waitFor(() => expect(passwordInCache(queryClient)).toBe(false));
    });

    it('apple_auth_failed → its copy, password cleared, email kept', async () => {
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        await fill(user, EMAIL, APPLE_PASSWORD_FAIL);
        await user.click(screen.getByTestId('apple-connect-submit'));
        expect(await screen.findByRole('alert')).toHaveTextContent(E.apple_auth_failed);
        expect(passwordInput()).toHaveValue('');
        expect(emailInput()).toHaveValue(EMAIL);
    });

    it('apple_unavailable (503) → the "iCloud didn\'t respond" copy, password kept', async () => {
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        await fill(user, EMAIL, APPLE_PASSWORD_DOWN);
        await user.click(screen.getByTestId('apple-connect-submit'));
        expect(await screen.findByRole('alert')).toHaveTextContent(E.apple_unavailable);
        expect(passwordInput()).toHaveValue(APPLE_PASSWORD_DOWN);
    });

    it('a refusal leaves the sheet open with its copy but no email or password in the mutation cache', async () => {
        const user = userEvent.setup();
        const { queryClient } = renderRow();
        await openSheet(user);
        await fill(user, EMAIL, APPLE_PASSWORD_DOWN);
        await user.click(screen.getByTestId('apple-connect-submit'));
        expect(await screen.findByRole('alert')).toHaveTextContent(E.apple_unavailable);
        const cached = queryClient.getMutationCache().getAll().map((m) => JSON.stringify(m.state.variables ?? null));
        expect(cached.filter((v) => v.includes(APPLE_PASSWORD_DOWN) || v.includes(EMAIL))).toEqual([]);
    });

    it('the route throttle (429) → "Too many tries"', async () => {
        server.use(appleConnectThrottledHandler());
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        await fill(user, EMAIL, PASSWORD);
        await user.click(screen.getByTestId('apple-connect-submit'));
        expect(await screen.findByRole('alert')).toHaveTextContent(E.throttled);
    });
});

describe('AppleConnectSheet — close and reconnect', () => {
    it('closing with typed input asks first; Discard wipes the password for the next open and the cache', async () => {
        const user = userEvent.setup();
        const { queryClient } = renderRow();
        await openSheet(user);
        await fill(user, EMAIL, APPLE_PASSWORD_DOWN);
        await user.click(screen.getByTestId('apple-connect-submit'));
        await screen.findByRole('alert');
        await user.click(screen.getByTestId('apple-connect-cancel'));
        await user.click(await screen.findByRole('button', { name: 'Discard' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        await waitFor(() => expect(queryClient.getMutationCache().getAll()).toHaveLength(0));
        await openSheet(user);
        expect(passwordInput()).toHaveValue('');
        expect(emailInput()).toHaveValue('');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('Keep editing keeps the draft', async () => {
        const user = userEvent.setup();
        renderRow();
        await openSheet(user);
        await fill(user, EMAIL, PASSWORD);
        await user.keyboard('{Escape}');
        await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
        expect(passwordInput()).toHaveValue(PASSWORD);
    });

    it('reconnect mode retitles the sheet and prefills the email from the connection', async () => {
        const connection = buildAppleConnection({ status: 'needs_reconnect', accountLabel: 'old@icloud.com' });
        render(
            <QueryClientProvider client={createTestQueryClient()}>
                <AppleConnectSheet isOpen onClose={() => {}} mode="reconnect" connection={connection} />
            </QueryClientProvider>,
        );
        expect(await screen.findByRole('dialog', { name: A.titleReconnect })).toBeInTheDocument();
        expect(emailInput()).toHaveValue('old@icloud.com');
        expect(passwordInput()).toHaveValue('');
    });
});
