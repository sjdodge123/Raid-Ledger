/** ROK-1960 §9 Vitest (L3) — the "Upload a save" sheet: pick/drop → preview → Upload → result, §7 banners, close guards. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { bg3LevelDisplay } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    BG3_KEY_URL, bg3BindKeyHandler, bg3CampaignsHandler, bg3KeyBindingHandler, bg3MySavesHandler,
} from '../../../test/mocks/bg3-handlers';
import {
    COMPANION_BG3_MESSAGE_URL, companionBg3MessageHandler, companionBlobHandler, type CompanionRefusal,
} from '../../../test/mocks/bg3-companion-handlers';
import { BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignsResponse, buildBg3MySavesResponse } from '../../../test/factories/bg3';
import { buildBg3ParsedSave } from '../../../test/factories/bg3-upload';
import { toast } from '../../../lib/toast';
import { parseBg3Save } from './bg3-parse-save';
import { disposeBg3ParseWorker } from './bg3-parse-client';
import { Bg3ParseError } from './bg3-parse-errors';
import { Bg3UploadSaveSheet } from './bg3-upload-save-sheet';
import { BG3_UPLOAD_PRIVACY_NOTE } from './bg3-upload-preview';

// No WASM in jsdom: the reader is stubbed; `selectBg3SaveSource` stays real.
vi.mock('./bg3-parse-save', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./bg3-parse-save')>()),
    parseBg3Save: vi.fn(),
}));
vi.mock('./bg3-parse-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./bg3-parse-client')>()),
    disposeBg3ParseWorker: vi.fn(),
}));
vi.mock('../../../lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const THUMB_URL = 'blob:bg3-thumb';
const DISCARD = "The save you picked won't be uploaded.";
const calls: string[] = [];
const onClose = vi.fn();
const lsv = (name = 'QuickSave_1.lsv'): File => new File([new Uint8Array([1, 2, 3])], name);

function routes(message: 'accepted' | 'stale' | CompanionRefusal = 'accepted'): void {
    server.use(
        companionBlobHandler('stored', () => calls.push('blob')),
        companionBg3MessageHandler(message, () => calls.push('message')),
        bg3BindKeyHandler(() => calls.push('bind')),
    );
}

function renderSheet() {
    return renderWithProviders(<Bg3UploadSaveSheet isOpen hubId={BG3_HUB_ID} onClose={onClose} />);
}

const fileInput = (): HTMLInputElement => {
    const el = screen.getByTestId('bg3-upload-input');
    if (!(el instanceof HTMLInputElement)) throw new Error('missing: FilePicker input');
    return el;
};

async function choose(user: ReturnType<typeof userEvent.setup>, file = lsv()): Promise<HTMLElement> {
    renderSheet();
    await user.upload(fileInput(), file);
    return screen.findByTestId('bg3-upload-preview');
}

beforeEach(() => {
    calls.length = 0;
    onClose.mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(disposeBg3ParseWorker).mockClear();
    vi.mocked(parseBg3Save).mockReset().mockResolvedValue(buildBg3ParsedSave());
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => THUMB_URL) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    server.use(
        bg3CampaignsHandler(buildBg3CampaignsResponse()),
        bg3MySavesHandler(buildBg3MySavesResponse({ defaultCampaignId: BG3_CAMPAIGN_ID })),
        bg3KeyBindingHandler(null),
    );
    routes();
});

afterEach(() => expect(toast.error).not.toHaveBeenCalled());

describe('pick → preview → upload', () => {
    it('choosing a save (keyboard path) shows the local preview without any companion call', async () => {
        const user = userEvent.setup();
        const preview = await choose(user);
        expect(within(preview).getByText('QuickSave_1')).toBeInTheDocument();
        expect(within(preview).getByText(new RegExp(bg3LevelDisplay('SCL_Main_A').label))).toBeInTheDocument();
        expect(within(preview).getByRole('list', { name: 'Party' })).toHaveTextContent(/Barbarian.*Level 8/);
        expect(screen.getByTestId('bg3-upload-thumb').getAttribute('src')).toBe(THUMB_URL);
        expect(within(preview).getByText(BG3_UPLOAD_PRIVACY_NOTE)).toBeInTheDocument();
        expect(vi.mocked(parseBg3Save).mock.calls[0]?.[0]).toMatchObject({ folderName: null });
        expect(calls).toEqual([]);
    });

    it('Upload sends the blob and the message, then says where it landed', async () => {
        const user = userEvent.setup();
        await choose(user);
        await waitFor(() => expect(screen.getByLabelText('Campaign')).toHaveDisplayValue('Tactician run'));
        await user.click(screen.getByRole('button', { name: 'Upload' }));
        expect(await screen.findByTestId('bg3-upload-banner-success')).toHaveTextContent('Uploaded to Tactician run');
        expect(calls).toEqual(['blob', 'bind', 'message']);
        await user.click(screen.getByRole('button', { name: 'Done' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the Campaign label names the picker alone and does not wrap it', async () => {
        await choose(userEvent.setup());
        const picker = screen.getByLabelText('Campaign');
        expect(picker).toBe(screen.getByRole('combobox'));
        expect(screen.getByText('Campaign').closest('label')).not.toContainElement(picker);
    });

    it('dropping a .lsv onto the zone reads it the same way', async () => {
        renderSheet();
        fireEvent.drop(screen.getByTestId('bg3-upload-drop-zone'), { dataTransfer: { files: [lsv()] } });
        expect(await screen.findByTestId('bg3-upload-preview')).toBeInTheDocument();
        expect(parseBg3Save).toHaveBeenCalledTimes(1);
    });

    it('a stale ack says "Already uploaded." as info, not danger', async () => {
        routes('stale');
        const user = userEvent.setup();
        await choose(user);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Upload' }));
        expect(await screen.findByTestId('bg3-upload-banner-info')).toHaveTextContent('Already uploaded.');
        expect(screen.queryByTestId('bg3-upload-banner-danger')).not.toBeInTheDocument();
    });
});

describe('errors are inline banners (§7)', () => {
    it('a parse error shows its banner and sends nothing', async () => {
        vi.mocked(parseBg3Save).mockRejectedValue(new Bg3ParseError('not_a_save'));
        const user = userEvent.setup();
        renderSheet();
        await user.upload(fileInput(), lsv());
        expect(await screen.findByRole('alert')).toHaveTextContent("This isn't a Baldur's Gate 3 save (.lsv).");
        expect(screen.getByTestId('bg3-upload-drop-zone')).toBeInTheDocument();
        expect(calls).toEqual([]);
    });

    it('two saves in one drop → "Drop one save folder at a time." and the reader never runs', async () => {
        renderSheet();
        fireEvent.drop(screen.getByTestId('bg3-upload-drop-zone'), { dataTransfer: { files: [lsv('a.lsv'), lsv('b.lsv')] } });
        expect(await screen.findByRole('alert')).toHaveTextContent('Drop one save folder at a time.');
        expect(parseBg3Save).not.toHaveBeenCalled();
    });

    it('a failed bind posts nothing: its banner says so, and closing still warns the save won\'t be uploaded', async () => {
        server.use(http.put(BG3_KEY_URL, () => {
            calls.push('bind');
            return HttpResponse.json({ message: 'nope' }, { status: 500 });
        }));
        const user = userEvent.setup();
        await choose(user);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Upload' }));
        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't file the save under that campaign, so it wasn't uploaded. Try again.");
        expect(calls).toEqual(['blob', 'bind']);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByText(DISCARD)).toBeInTheDocument();
    });

    it('429 says "try again in a minute" and keeps the preview for a retry', async () => {
        routes({ status: 429, code: 'rate_limited' });
        const user = userEvent.setup();
        await choose(user);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Upload' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Too many uploads. Try again in a minute.');
        expect(screen.getByTestId('bg3-upload-preview')).toBeInTheDocument();
    });
});

describe('close paths', () => {
    it('Cancel before a save is picked closes at once', async () => {
        const user = userEvent.setup();
        renderSheet();
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a parsed, not-yet-uploaded save asks before closing', async () => {
        const user = userEvent.setup();
        await choose(user);
        await user.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).not.toHaveBeenCalled();
        expect(await screen.findByText(DISCARD)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Discard' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('blocks Cancel while the upload is in flight', async () => {
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => { release = resolve; });
        server.use(http.post(COMPANION_BG3_MESSAGE_URL, async () => {
            await held;
            return HttpResponse.json({ status: 'accepted' }, { status: 202 });
        }));
        const user = userEvent.setup();
        await choose(user);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Upload' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled());
        await user.keyboard('{Escape}');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.queryByText(DISCARD)).not.toBeInTheDocument();
        release();
        expect(await screen.findByTestId('bg3-upload-banner-success')).toBeInTheDocument();
    });

    it('closing mid-parse terminates the parse worker and revokes the late thumbnail URL', async () => {
        let finish: () => void = () => {};
        vi.mocked(parseBg3Save).mockImplementation(() => new Promise((resolve) => {
            finish = () => resolve(buildBg3ParsedSave());
        }));
        const user = userEvent.setup();
        const view = renderSheet();
        await user.upload(fileInput(), lsv());
        await waitFor(() => expect(parseBg3Save).toHaveBeenCalledTimes(1));
        expect(disposeBg3ParseWorker).not.toHaveBeenCalled();
        view.unmount();
        expect(disposeBg3ParseWorker).toHaveBeenCalledTimes(1);
        finish();
        // The read settles (and builds its URL) in one microtask drain; by the time waitFor sees it, the drop ran too.
        await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(THUMB_URL);
    });

    it('revokes the thumbnail object URL when the sheet goes away', async () => {
        const user = userEvent.setup();
        const view = renderSheet();
        await user.upload(fileInput(), lsv());
        await screen.findByTestId('bg3-upload-preview');
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        view.unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(THUMB_URL);
    });
});

describe('cross-hub bind asks first (operator ruling 2026-10-31)', () => {
    const elsewhere = { campaignId: 99, campaignName: 'Honour run', hubId: BG3_HUB_ID + 1, hubName: 'Other Crew', saveCount: 3 };

    async function uploadClick(user: ReturnType<typeof userEvent.setup>): Promise<void> {
        await choose(user);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled());
        await user.click(screen.getByRole('button', { name: 'Upload' }));
    }

    /** Settled = the sheet either asks or says it uploaded (so a wrong path fails on its own assertion, not a timeout). */
    const CONFIRM = 'bg3-upload-move-confirm';
    const settled = (): Promise<void> => waitFor(() => expect(
        screen.queryByTestId(CONFIRM) ?? screen.queryByTestId('bg3-upload-banner-success')).not.toBeNull());

    it('an unbound key uploads without asking', async () => {
        const user = userEvent.setup();
        await uploadClick(user);
        await settled();
        expect(screen.queryByTestId(CONFIRM)).not.toBeInTheDocument();
        expect(calls).toEqual(['blob', 'bind', 'message']);
    });

    it('a key bound to another campaign in THIS hub uploads without asking', async () => {
        server.use(bg3KeyBindingHandler({ ...elsewhere, hubId: BG3_HUB_ID, hubName: 'BG3 Crew' }));
        const user = userEvent.setup();
        await uploadClick(user);
        await settled();
        expect(screen.queryByTestId(CONFIRM)).not.toBeInTheDocument();
        expect(calls).toEqual(['blob', 'bind', 'message']);
    });

    it('a key bound in another hub stops before any bind; Cancel moves and posts nothing', async () => {
        server.use(bg3KeyBindingHandler(elsewhere));
        const user = userEvent.setup();
        await uploadClick(user);
        await settled();
        expect(calls).toEqual([]);
        const confirm = screen.getByTestId(CONFIRM);
        expect(confirm).toHaveTextContent(
            "This playthrough's saves are in Honour run in Other Crew. Moving it here also moves your 3 earlier saves.");
        expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
        await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByTestId(CONFIRM)).not.toBeInTheDocument();
        expect(screen.getByTestId('bg3-upload-preview')).toBeInTheDocument();
        expect(calls).toEqual([]);
    });

    it('Move here binds, then posts', async () => {
        server.use(bg3KeyBindingHandler(elsewhere));
        const user = userEvent.setup();
        await uploadClick(user);
        await settled();
        expect(calls).toEqual([]);
        const confirm = screen.getByTestId(CONFIRM);
        await user.click(within(confirm).getByRole('button', { name: 'Move here' }));
        expect(await screen.findByTestId('bg3-upload-banner-success')).toHaveTextContent('Uploaded to Tactician run');
        expect(calls).toEqual(['blob', 'bind', 'message']);
    });

    it('a hub the uploader can no longer open is not named, but still asks', async () => {
        const redacted = { campaignId: null, campaignName: null, hubId: null, hubName: null, saveCount: 1 };
        server.use(bg3KeyBindingHandler(redacted));
        const user = userEvent.setup();
        await uploadClick(user);
        await settled();
        expect(calls).toEqual([]);
        expect(screen.getByTestId(CONFIRM)).toHaveTextContent(
            "This playthrough's saves are in a hub you can no longer open. Moving it here also moves your 1 earlier save.");
    });
});
