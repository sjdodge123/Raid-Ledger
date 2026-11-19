/**
 * ROK-2263 — ShowOnceSecretDialog: the secret is shown masked, Copy copies it,
 * closing before a copy asks the discard guard, Leave closes (the caller
 * unmounts it and the secret goes with it), and a copy disarms the guard.
 */
import { useState, type JSX } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { ShowOnceSecretDialog } from './show-once-secret-dialog';

vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const SECRET = 'rlbx_TEST_secret_value_0123456789abcdefghijklmnop';
const TITLE = 'New clone access token';

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
    window.matchMedia = (query: string) => ({
        matches: query === DESKTOP_MQ, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    });
    // The async Clipboard API path (a real HTTPS origin); userEvent stubs the clipboard.
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});
afterEach(() => { window.matchMedia = originalMatchMedia; });

/** Mounts the dialog only while open, like every caller does. */
function Harness({ onClose }: { onClose: () => void }): JSX.Element | null {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
        <ShowOnceSecretDialog title={TITLE} secret={SECRET} explainer="Shown once — copy it now."
            onClose={() => { onClose(); setOpen(false); }} />
    );
}

async function openDialog(onClose = vi.fn()) {
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    return { user, dialog, onClose };
}

describe('ShowOnceSecretDialog', () => {
    it('shows the secret masked with the explainer, and reveals it on Show', async () => {
        const { user, dialog } = await openDialog();
        expect(within(dialog).getByRole('status')).toHaveTextContent('Shown once — copy it now.');
        const field = within(dialog).getByTestId('show-once-secret-value');
        expect(field).toHaveAttribute('type', 'password');
        expect(field).toHaveAttribute('readonly');
        await user.click(within(dialog).getByRole('button', { name: 'Show token' }));
        expect(field).toHaveAttribute('type', 'text');
        expect(field).toHaveValue(SECRET);
    });

    it('Copy puts the secret on the clipboard, flips to "Copied", and Done then closes without asking', async () => {
        const { user, dialog, onClose } = await openDialog();
        await user.click(within(dialog).getByRole('button', { name: 'Copy token' }));
        await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(SECRET));
        expect(within(dialog).getByTestId('show-once-secret-copy')).toHaveTextContent('Copied');
        await user.click(within(dialog).getByRole('button', { name: 'Done' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.queryByText('Leave without copying the token?')).not.toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.body.innerHTML).not.toContain(SECRET);
    });

    it('closing before a copy asks the discard guard; Stay keeps the secret', async () => {
        const { user, dialog, onClose } = await openDialog();
        await user.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(await screen.findByText('Leave without copying the token?')).toBeInTheDocument();
        expect(screen.getByText("This token won't be shown again.")).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Stay' }));
        await waitFor(() => expect(screen.queryByText('Leave without copying the token?')).not.toBeInTheDocument());
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('show-once-secret-value')).toHaveValue(SECRET);
    });

    it('confirming Leave closes the dialog and the secret leaves the DOM', async () => {
        const { user, dialog, onClose } = await openDialog();
        await user.keyboard('{Escape}');
        expect(await screen.findByText('Leave without copying the token?')).toBeInTheDocument();
        expect(dialog).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Leave' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.body.innerHTML).not.toContain(SECRET);
    });
});

/** ROK-2264 — below 1024px it is a BottomSheet, and the guard keeps its show-once wording there too. */
describe('ShowOnceSecretDialog — phone (BottomSheet)', () => {
    beforeEach(() => {
        window.matchMedia = (query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        });
    });

    it('closing before a copy shows the show-once title and Stay/Leave, not "Discard your changes?"', async () => {
        const { user, dialog, onClose } = await openDialog();
        expect(within(dialog).queryByTestId('bottom-sheet-footer'), 'the phone path must render the BottomSheet').not.toBeNull();
        await user.click(within(dialog).getByRole('button', { name: 'Done' }));
        expect(await screen.findByText('Leave without copying the token?')).toBeInTheDocument();
        expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Stay' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Leave' }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
});
