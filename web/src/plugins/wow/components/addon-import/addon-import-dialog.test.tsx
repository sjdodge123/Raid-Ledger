/**
 * ROK-1724 §5 — the Import string dialog's paste → preview → result flow,
 * its inline error banners, the dirty-close guard, the Modal/BottomSheet
 * split and the closed-before-apply toast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { toast } from '../../../../lib/toast';
import { AddonImportDialog } from './addon-import-dialog';
import { CHARACTER_ID, CHAR_STRING, IMPORT_URL, charResult } from './addon-import.test-fixtures';

vi.mock('../../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const originalMatchMedia = window.matchMedia;

function mockViewportWidth(width: number): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        return {
            matches: !!min && width >= Number(min[1]), media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
        };
    }) as unknown as typeof window.matchMedia;
}

interface Reply { status: number; body: Record<string, unknown> }
const OK_PREVIEW: Reply = { status: 200, body: charResult() };
const OK_APPLY: Reply = { status: 200, body: charResult({ status: 'applied' }) };

/** One handler for both calls, branching on `dryRun`; `gate` holds the apply response until released. */
function mockImport(preview: Reply = OK_PREVIEW, apply: Reply = OK_APPLY, gate?: Promise<void>) {
    const bodies: { dryRun: boolean }[] = [];
    server.use(http.post(IMPORT_URL, async ({ request }) => {
        const body = await request.json() as { dryRun: boolean };
        bodies.push(body);
        if (!body.dryRun && gate) await gate;
        const reply = body.dryRun ? preview : apply;
        return HttpResponse.json(reply.body, { status: reply.status });
    }));
    return bodies;
}

function renderDialog(isOpen = true) {
    const onClose = vi.fn();
    const utils = renderWithProviders(<AddonImportDialog isOpen={isOpen} onClose={onClose} characterId={CHARACTER_ID} gameId={7} />);
    return { ...utils, onClose };
}

async function pasteAndCheck(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/Export string/), CHAR_STRING);
    await user.click(screen.getByRole('button', { name: 'Check string' }));
    await screen.findByRole('button', { name: 'Import' });
}

beforeEach(() => { mockViewportWidth(1280); vi.mocked(toast.success).mockClear(); });
afterEach(() => { window.matchMedia = originalMatchMedia; });

describe('AddonImportDialog flow', () => {
    it('previews with dryRun:true, applies with dryRun:false, then shows the result', async () => {
        const bodies = mockImport();
        const user = userEvent.setup();
        renderDialog();
        await pasteAndCheck(user);
        expect(bodies.map((b) => b.dryRun)).toEqual([true]);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
        expect(bodies.map((b) => b.dryRun)).toEqual([true, false]);
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows a preview error as an inline banner and stays on the paste step', async () => {
        mockImport({ status: 422, body: { code: 'CUT_OFF', message: 'cut' } });
        const user = userEvent.setup();
        renderDialog();
        await user.type(screen.getByLabelText(/Export string/), CHAR_STRING);
        await user.click(screen.getByRole('button', { name: 'Check string' }));
        expect(await screen.findByText('String looks cut off')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('shows an apply error as an inline banner on the preview step', async () => {
        mockImport(OK_PREVIEW, { status: 429, body: { code: 'RATE_LIMITED', message: 'slow down' } });
        const user = userEvent.setup();
        renderDialog();
        await pasteAndCheck(user);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        expect(await screen.findByText('Too many imports')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });

    it('toasts once when the dialog was closed before the apply landed', async () => {
        let release!: () => void;
        mockImport(OK_PREVIEW, OK_APPLY, new Promise<void>((r) => { release = r; }));
        const user = userEvent.setup();
        const { rerender, onClose } = renderDialog();
        await pasteAndCheck(user);
        await user.click(screen.getByRole('button', { name: 'Import' }));
        rerender(<AddonImportDialog isOpen={false} onClose={onClose} characterId={CHARACTER_ID} gameId={7} />);
        release();
        await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    });
});

describe('AddonImportDialog close guard', () => {
    it('closes straight away when nothing was pasted', async () => {
        const user = userEvent.setup();
        const { onClose } = renderDialog();
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('asks before discarding a pasted string', async () => {
        const user = userEvent.setup();
        const { onClose } = renderDialog();
        await user.type(screen.getByLabelText(/Export string/), CHAR_STRING);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        const confirm = await screen.findByTestId('discard-changes-confirm');
        expect(within(confirm).getByText('Discard the pasted import string?')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
        await user.click(within(confirm).getByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe('AddonImportDialog frame', () => {
    it('is a Modal at desktop width', () => {
        renderDialog();
        expect(screen.getByTestId('modal-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('bottom-sheet-footer')).toBeNull();
    });

    it('is a BottomSheet below 1024px', () => {
        mockViewportWidth(375);
        renderDialog();
        expect(screen.getByTestId('bottom-sheet-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('modal-footer')).toBeNull();
    });
});
