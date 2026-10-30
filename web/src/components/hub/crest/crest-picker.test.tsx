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
const pic = (id: number, caption: string): HubMediaItem => ({ id, caption, thumbPath: `/t/${id}`, hidden: false }) as HubMediaItem;
const gallery = { items: [pic(42, 'Raid night'), pic(43, 'Boss kill')], loading: false, hasMore: false, loadingMore: false, loadMore: vi.fn() };
vi.mock('../gallery/use-hub-gallery-pages', () => ({ useHubGalleryPages: () => gallery }));

const STATE: GuildCrestEditorState = { active: null, upload: null, preset: null, removedByStaffAt: null };
const set = { mutate: vi.fn(), isPending: false, error: null };
const pick = { mutate: vi.fn(), isPending: false, error: null };
const upload = { mutate: vi.fn(), isPending: false, error: null as Error | null };

const editor = (q: object): ReturnType<typeof hooks.useGuildCrestEditor> => q as unknown as ReturnType<typeof hooks.useGuildCrestEditor>;

function mockHooks(state: GuildCrestEditorState = STATE): void {
    vi.mocked(hooks.useGuildCrestEditor).mockReturnValue(editor({ data: state, isError: false }));
    vi.mocked(hooks.useSetGuildCrest).mockReturnValue(set as unknown as ReturnType<typeof hooks.useSetGuildCrest>);
    vi.mocked(hooks.usePickGuildCrestFromGallery).mockReturnValue(pick as unknown as ReturnType<typeof hooks.usePickGuildCrestFromGallery>);
    vi.mocked(hooks.useUploadGuildCrest).mockReturnValue(upload as unknown as ReturnType<typeof hooks.useUploadGuildCrest>);
}

const renderPicker = (): void => { render(<CrestPicker guildId={7} name="Iron Wolves" onClose={vi.fn()} />); };

describe('CrestPicker', () => {
    beforeEach(() => { vi.clearAllMocks(); upload.error = null; gallery.hasMore = false; mockHooks(); });

    it('keeps the dialog open with a loading state while the crest loads', () => {
        vi.mocked(hooks.useGuildCrestEditor).mockReturnValue(editor({ data: undefined, isError: false, isPending: true }));
        renderPicker();
        expect(screen.getByTestId('crest-picker-loading')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByTestId('crest-picker-cancel')).toBeInTheDocument();
    });

    it('shows an error with Retry when the crest fails to load', async () => {
        const refetch = vi.fn();
        vi.mocked(hooks.useGuildCrestEditor).mockReturnValue(editor({ data: undefined, isError: true, refetch }));
        renderPicker();
        expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the crest");
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(refetch).toHaveBeenCalled();
    });

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

    it('maps a coded upload error to friendly copy', async () => {
        upload.error = withErrorBody(withHttpStatus(new Error('x'), 415), { code: 'not_image' });
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Upload' }));
        expect(screen.getByTestId('crest-upload-error')).toHaveTextContent("SVG files aren't allowed");
    });

    it('stages a picked file and uploads it only on Save', async () => {
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Upload' }));
        expect(screen.getByTestId('crest-picker-save')).toBeDisabled();
        const file = new File(['a'], 'c.png', { type: 'image/png' });
        await userEvent.upload(screen.getByTestId('crest-upload-input'), file);
        expect(upload.mutate).not.toHaveBeenCalled();
        expect(screen.getByTestId('crest-upload-staged')).toHaveTextContent('c.png');
        await userEvent.click(screen.getByTestId('crest-picker-save'));
        expect(upload.mutate).toHaveBeenCalledWith(file, expect.anything());
    });

    it('discards a staged file on Cancel', async () => {
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Upload' }));
        await userEvent.upload(screen.getByTestId('crest-upload-input'), new File(['a'], 'c.png', { type: 'image/png' }));
        await userEvent.click(screen.getByTestId('crest-picker-cancel'));
        expect(upload.mutate).not.toHaveBeenCalled();
        expect(set.mutate).not.toHaveBeenCalled();
    });

});

describe('CrestPicker gallery', () => {
    beforeEach(() => { vi.clearAllMocks(); gallery.hasMore = false; mockHooks(); });

    it('posts a gallery pick', async () => {
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Gallery' }));
        expect(screen.getByTestId('crest-picker-save')).toBeDisabled();
        await userEvent.click(screen.getByTestId('crest-gallery-option-42'));
        await userEvent.click(screen.getByTestId('crest-picker-save'));
        expect(pick.mutate).toHaveBeenCalledWith(42, expect.anything());
    });

    it('makes the gallery a radio group that arrow keys move through', async () => {
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Gallery' }));
        const group = screen.getByRole('radiogroup', { name: 'Gallery pictures' });
        expect(group).toBeInTheDocument();
        await userEvent.click(screen.getByRole('radio', { name: 'Raid night' }));
        expect(screen.getByRole('radio', { name: 'Raid night' })).toHaveAttribute('aria-checked', 'true');
        await userEvent.keyboard('{ArrowRight}');
        const next = screen.getByRole('radio', { name: 'Boss kill' });
        expect(next).toHaveAttribute('aria-checked', 'true');
        expect(next).toHaveFocus();
        expect(screen.getByRole('radio', { name: 'Raid night' })).toHaveAttribute('tabindex', '-1');
    });

    it('loads more gallery pictures on demand', async () => {
        gallery.hasMore = true;
        renderPicker();
        await userEvent.click(screen.getByRole('radio', { name: 'Gallery' }));
        await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
        expect(gallery.loadMore).toHaveBeenCalled();
    });

    it('tells editors an admin removed the upload', () => {
        mockHooks({ ...STATE, removedByStaffAt: '2026-10-29T12:00:00.000Z' });
        renderPicker();
        const notice = screen.getByTestId('crest-removed-notice');
        expect(notice).toHaveTextContent('Removed by an admin on');
        expect(notice).toHaveClass('border-warning/30', 'text-warning');
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
