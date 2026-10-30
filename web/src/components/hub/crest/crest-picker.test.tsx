import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuildCrestEditorState, HubMediaItem } from '@raid-ledger/contract';
import { withErrorBody, withHttpStatus } from '../../../lib/api/api-error';
import * as hooks from './use-guild-crest';
import { CrestPicker } from './crest-picker';
import { HeroCrest } from './hero-crest';

vi.mock('./use-guild-crest');
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../../../hooks/use-hub-media-image', () => ({ useHubMediaImageUrl: () => null }));
vi.mock('../gallery/use-hub-gallery-pages', () => ({
    useHubGalleryPages: () => ({ items: [{ id: 42, caption: 'Raid night', thumbPath: '/t/42', hidden: false } as HubMediaItem], loading: false }),
}));

const STATE: GuildCrestEditorState = { active: null, upload: null, preset: null, removedByStaffAt: null };
const set = { mutate: vi.fn(), isPending: false, error: null };
const pick = { mutate: vi.fn(), isPending: false, error: null };
const upload = { mutate: vi.fn(), isPending: false, error: null as Error | null };

function mockHooks(state: GuildCrestEditorState = STATE): void {
    vi.mocked(hooks.useGuildCrestEditor).mockReturnValue({ data: state } as unknown as ReturnType<typeof hooks.useGuildCrestEditor>);
    vi.mocked(hooks.useSetGuildCrest).mockReturnValue(set as unknown as ReturnType<typeof hooks.useSetGuildCrest>);
    vi.mocked(hooks.usePickGuildCrestFromGallery).mockReturnValue(pick as unknown as ReturnType<typeof hooks.usePickGuildCrestFromGallery>);
    vi.mocked(hooks.useUploadGuildCrest).mockReturnValue(upload as unknown as ReturnType<typeof hooks.useUploadGuildCrest>);
}

const renderPicker = (): void => { render(<CrestPicker guildId={7} name="Iron Wolves" onClose={vi.fn()} />); };

describe('CrestPicker', () => {
    beforeEach(() => { vi.clearAllMocks(); upload.error = null; mockHooks(); });

    it('saves the picked preset', async () => {
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Wolf head' }));
        await userEvent.click(screen.getByTestId('crest-picker-save'));
        expect(set.mutate).toHaveBeenCalledWith(
            { active: 'preset', preset: { emblemId: 'wolf-head', fg: 'or', bg: 'azure' } }, expect.anything());
    });

    it('refuses an emblem colour equal to the background', async () => {
        renderPicker();
        await userEvent.click(within('crest-bg-swatches', 'Or'));
        expect(screen.getByTestId('crest-colour-clash')).toBeInTheDocument();
        expect(screen.getByTestId('crest-picker-save')).toBeDisabled();
    });

    it('maps a coded upload error to friendly copy and uploads the chosen file', async () => {
        upload.error = withErrorBody(withHttpStatus(new Error('x'), 415), { code: 'not_image' });
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Upload' }));
        expect(screen.getByTestId('crest-upload-error')).toHaveTextContent("SVG files aren't allowed");
        const file = new File(['a'], 'c.png', { type: 'image/png' });
        await userEvent.upload(screen.getByTestId('crest-upload-input'), file);
        expect(upload.mutate).toHaveBeenCalledWith(file);
    });

    it('posts a gallery pick', async () => {
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Gallery' }));
        expect(screen.getByTestId('crest-picker-save')).toBeDisabled();
        await userEvent.click(screen.getByTestId('crest-gallery-option-42'));
        await userEvent.click(screen.getByTestId('crest-picker-save'));
        expect(pick.mutate).toHaveBeenCalledWith(42, expect.anything());
    });

    it('tells editors an admin removed the upload', () => {
        mockHooks({ ...STATE, removedByStaffAt: '2026-10-29T12:00:00.000Z' });
        renderPicker();
        expect(screen.getByTestId('crest-removed-notice')).toHaveTextContent('Removed by an admin on');
    });
});

function within(testId: string, name: string): HTMLElement {
    const group = screen.getByTestId(testId);
    const radio = Array.from(group.querySelectorAll('input')).find((i) => i.getAttribute('aria-label') === name);
    if (!radio) throw new Error(`no ${name} radio in ${testId}`);
    return radio;
}

describe('HeroCrest', () => {
    beforeEach(() => { mockHooks(); });

    it('gives a non-editor no button', () => {
        render(<HeroCrest guildId={7} name="Iron Wolves" crest={null} canEdit={false} className="" />);
        expect(screen.queryByTestId('hub-crest-edit')).toBeNull();
    });

    it('opens the picker for an editor', async () => {
        render(<HeroCrest guildId={7} name="Iron Wolves" crest={null} canEdit className="" />);
        await userEvent.click(screen.getByRole('button', { name: 'Change crest' }));
        expect(screen.getByTestId('crest-picker')).toBeInTheDocument();
    });
});
