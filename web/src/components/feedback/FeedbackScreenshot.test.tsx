/**
 * ROK-1313 — the feedback widget's screenshot step: paste or attach a PNG/JPEG,
 * preview it, remove it, and send it (base64 without the `data:` prefix) plus
 * the page's clientContext; the Sentry event gets the bytes as an attachment.
 * A text paste into the message box is never intercepted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CreateFeedbackDto } from '@raid-ledger/contract';
import { useAuth } from '../../hooks/use-auth';
import { captureMessageVerified } from '../../sentry';
import { FeedbackWidget } from './FeedbackWidget';
import { SCREENSHOT_ERROR } from './feedback-screenshot';

type MutateOpts = { onSuccess?: (data: { id: number }) => Promise<void> | void };
const mutate = vi.hoisted(() => vi.fn<(payload: CreateFeedbackDto, opts: MutateOpts) => void>());

vi.mock('../../hooks/use-auth', () => ({ useAuth: vi.fn() }));
vi.mock('../../hooks/use-feedback', () => ({
    useSubmitFeedback: () => ({ mutate, reset: vi.fn(), error: null, isError: false }),
}));
vi.mock('../../sentry', () => ({ captureMessageVerified: vi.fn(() => Promise.resolve(true)) }));

const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_BASE64 = 'iVBORw0KGgo=';
const png = (): File => new File([new Uint8Array(PNG_BYTES)], 'shot.png', { type: 'image/png' });
const revoke = vi.fn();

beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true } as ReturnType<typeof useAuth>);
    mutate.mockReset();
    vi.mocked(captureMessageVerified).mockClear();
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: revoke });
});
afterEach(() => { revoke.mockClear(); });

async function openDialog() {
    const user = userEvent.setup({ applyAccept: false });
    render(<FeedbackWidget />);
    await user.click(screen.getByRole('button', { name: 'Send Feedback' }));
    const dialog = screen.getByRole('dialog', { name: 'Send Feedback' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'The roster page is broken');
    return { user, dialog };
}

function pasteFiles(files: File[]): Event {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files, items: [] } });
    document.dispatchEvent(event);
    return event;
}

async function submit(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement): Promise<CreateFeedbackDto> {
    await user.click(within(dialog).getByRole('button', { name: 'Send Feedback' }));
    const call = mutate.mock.calls.at(-1);
    if (!call) throw new Error('mutate was not called');
    return call[0];
}

const fileInput = (dialog: HTMLElement): HTMLInputElement => {
    const input = dialog.querySelector<HTMLInputElement>('input[type=file]');
    if (!input) throw new Error('no file input');
    return input;
};

describe('FeedbackWidget — screenshot paste', () => {
    it('a pasted PNG previews and is sent as prefix-free base64 with clientContext + a Sentry attachment', async () => {
        const { user, dialog } = await openDialog();
        const event = pasteFiles([png()]);
        expect(event.defaultPrevented).toBe(true);
        expect(await within(dialog).findByRole('img', { name: 'Screenshot preview' })).toHaveAttribute('src', 'blob:preview');
        const body = await submit(user, dialog);
        expect(body.screenshotBase64).toBe(PNG_BASE64);
        expect(body.clientContext).toEqual({
            viewport: { w: window.innerWidth, h: window.innerHeight },
            userAgent: navigator.userAgent, appVersion: 'unknown',
        });
        await mutate.mock.calls.at(-1)?.[1].onSuccess?.({ id: 7 });
        const sentryCall = vi.mocked(captureMessageVerified).mock.calls.at(-1);
        expect(sentryCall?.[2]).toEqual([{ filename: 'screenshot.png', data: new Uint8Array(PNG_BYTES), contentType: 'image/png' }]);
        expect(sentryCall?.[1]).toMatchObject({ contexts: { feedback: { clientContext: body.clientContext } } });
    });

    it('a text paste into the message box is not intercepted', async () => {
        const { user, dialog } = await openDialog();
        const box = within(dialog).getByRole('textbox', { name: 'Message' });
        await user.click(box);
        await user.paste(' and the calendar');
        expect(box).toHaveValue('The roster page is broken and the calendar');
        expect(within(dialog).queryByRole('img', { name: 'Screenshot preview' })).not.toBeInTheDocument();
    });
});

describe('FeedbackWidget — screenshot picker', () => {
    it.each([
        ['PNG', png()],
        ['JPEG', new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'shot.jpg', { type: 'image/jpeg' })],
    ])('accepts a %s and shows the preview', async (_label, file) => {
        const { user, dialog } = await openDialog();
        expect(fileInput(dialog)).toHaveAttribute('accept', 'image/png,image/jpeg');
        await user.upload(fileInput(dialog), file);
        expect(await within(dialog).findByRole('img', { name: 'Screenshot preview' })).toBeInTheDocument();
        expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
        ['a GIF', new File([new Uint8Array([0x47, 0x49, 0x46])], 'a.gif', { type: 'image/gif' })],
        ['a 3,750,001-byte PNG', new File([new Uint8Array(3_750_001)], 'big.png', { type: 'image/png' })],
    ])('refuses %s with a visible alert and no preview', async (_label, file) => {
        const { user, dialog } = await openDialog();
        await user.upload(fileInput(dialog), file);
        expect(within(dialog).getByRole('alert')).toHaveTextContent(SCREENSHOT_ERROR);
        expect(within(dialog).queryByRole('img', { name: 'Screenshot preview' })).not.toBeInTheDocument();
        expect((await submit(user, dialog)).screenshotBase64).toBeUndefined();
    });

    it('Remove screenshot clears the preview, revokes its URL, and the next submit omits it', async () => {
        const { user, dialog } = await openDialog();
        await user.upload(fileInput(dialog), png());
        await within(dialog).findByRole('img', { name: 'Screenshot preview' });
        await user.click(within(dialog).getByRole('button', { name: 'Remove screenshot' }));
        expect(within(dialog).queryByRole('img', { name: 'Screenshot preview' })).not.toBeInTheDocument();
        expect(revoke).toHaveBeenCalledWith('blob:preview');
        expect((await submit(user, dialog)).screenshotBase64).toBeUndefined();
    });
});
