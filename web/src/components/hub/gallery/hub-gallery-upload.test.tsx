/** ROK-1965 — Add picture on the Overview card: POST multipart `file`, toast, refresh, error copy. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { http, HttpResponse } from 'msw';
import type { GuildPage, HubMediaItem } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    HUB_MEDIA_LIST_URL, hubMediaFileHandler, hubMediaItem, hubMediaListHandler, hubMediaUploadHandler,
} from '../../../test/mocks/hub-media-handlers';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { HUB_MEDIA_UPLOAD_DUPLICATE, HUB_MEDIA_UPLOAD_ERROR_COPY } from '../../../lib/hub-media-upload-copy';
import { toast } from '../../../lib/toast';
import HubGalleryWidget from './hub-gallery-widget';
import { HubGallerySeeAll } from './hub-gallery-see-all';
import { useHubGalleryStore } from './hub-gallery-store';

vi.mock('../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const ctx = { page: { guild: { id: 5 }, viewer: { canEdit: false } } as GuildPage, gameSlug: 'valheim' } as HubWidgetCtx;
const Card = (): JSX.Element => <><HubGallerySeeAll {...ctx} /><HubGalleryWidget {...ctx} /></>;
const pick = (name = 'shot.png'): void => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    fireEvent.change(screen.getByTestId('hub-gallery-add-picture-input'), { target: { files: [file] } });
};

beforeEach(() => {
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.info).mockClear();
    useHubGalleryStore.setState({ filters: {}, request: null });
    server.use(hubMediaFileHandler);
});

describe('Add picture — upload', () => {
    it('POSTs the pick as multipart `file`, toasts "Picture added" and refreshes the card', async () => {
        const items: HubMediaItem[] = [hubMediaItem(2, 'death')];
        const sent: string[] = [];
        server.use(hubMediaListHandler(items), http.post(HUB_MEDIA_LIST_URL, async ({ request }) => {
            const file = (await request.formData()).get('file');
            sent.push(file instanceof File ? file.name : 'none');
            const added = hubMediaItem(1, 'upload', { canRemove: true });
            items.unshift(added);
            return HttpResponse.json(added, { status: 201 });
        }));
        renderWithProviders(<Card />);
        expect(await screen.findByRole('button', { name: 'See all (1)' })).toBeInTheDocument();
        pick();
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Picture added'));
        expect(sent).toEqual(['shot.png']);
        expect(await screen.findByRole('button', { name: 'See all (2)' })).toBeInTheDocument();
    });

    it('a 200 says the picture is already in the gallery', async () => {
        server.use(hubMediaListHandler([hubMediaItem(1, 'upload')]), hubMediaUploadHandler(hubMediaItem(1, 'upload'), 200));
        renderWithProviders(<Card />);
        await screen.findByRole('button', { name: 'Add picture' });
        pick();
        await waitFor(() => expect(toast.info).toHaveBeenCalledWith(HUB_MEDIA_UPLOAD_DUPLICATE));
        expect(toast.success).not.toHaveBeenCalled();
    });

    it.each([
        [415, 'not_image'], [413, 'too_large'], [413, 'cap'], [409, 'removed'], [429, 'rate_limited'], [503, 'busy'],
    ] as const)('a %i %s answer toasts its plain copy', async (status, code) => {
        server.use(hubMediaListHandler([]), hubMediaUploadHandler(hubMediaItem(1, 'upload'), status, code));
        renderWithProviders(<Card />);
        await screen.findByTestId('hub-gallery-empty');
        pick();
        await waitFor(() => expect(toast.error).toHaveBeenCalledWith(HUB_MEDIA_UPLOAD_ERROR_COPY[code]));
    });

    it('a phone header labels it "Add" but keeps the name "Add picture"', async () => {
        server.use(hubMediaListHandler([]));
        renderWithProviders(<Card />);
        const button = await screen.findByRole('button', { name: 'Add picture' });
        // jsdom's matchMedia matches nothing, so this is the phone (< 1024px) header.
        expect(button.querySelector('.sr-only')?.textContent).toBe(' picture');
    });
});
