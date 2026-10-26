/** ROK-1941 D14 — the Gallery dialog is mounted ONCE by the hub Overview, not by the Gallery card, so a Deaths thumb opens it with the card hidden. */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { hubMediaFileHandler, hubMediaItem, hubMediaListHandler } from '../../../test/mocks/hub-media-handlers';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { HubGalleryDialogMount } from './hub-gallery-dialog-mount';
import { type HubGalleryOpenRequest, useHubGalleryStore } from './hub-gallery-store';
import HubGalleryWidget from './hub-gallery-widget';

const ITEMS = [hubMediaItem(1, 'death'), hubMediaItem(2, 'screenshot')];

function request(guildId: number): HubGalleryOpenRequest {
    return { guildId, mode: 'viewer', filter: 'death', index: 0, mediaId: 1, returnFocus: null };
}

function ctx(): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'game_server', gameSlug: 'valheim' },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    // The card reads only `page.guild.id` and `page.viewer` (register.test idiom).
    return { page, gameSlug: 'valheim' } as HubWidgetCtx;
}

beforeEach(() => {
    server.use(hubMediaFileHandler, hubMediaListHandler(ITEMS));
    useHubGalleryStore.setState({ filters: {}, request: null });
});

describe('HubGalleryDialogMount (D14)', () => {
    it('opens the viewer for its hub with no Gallery card on the page', async () => {
        useHubGalleryStore.setState({ request: request(5) });
        renderWithProviders(<HubGalleryDialogMount guildId={5} canEdit={false} />);
        expect(await screen.findByRole('dialog', { name: 'Gallery' })).toBeTruthy();
        expect((await screen.findByTestId('hub-gallery-caption')).textContent).toMatch(/Player1(?!\d)/);
    });

    it("ignores another hub's request", async () => {
        useHubGalleryStore.setState({ request: request(6) });
        const { container } = renderWithProviders(<HubGalleryDialogMount guildId={5} canEdit={false} />);
        expect(container.innerHTML).toBe('');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('the Gallery card no longer mounts its own dialog (one dialog per Overview)', async () => {
        renderWithProviders(<HubGalleryWidget {...ctx()} />);
        await waitFor(() => expect(screen.getAllByTestId('hub-gallery-tile')).toHaveLength(2));
        useHubGalleryStore.setState({ request: request(5) });
        // The dialog is lazy: give its chunk time to resolve before asserting it never appears.
        await expect(screen.findByRole('dialog', {}, { timeout: 1500 }), 'the card mounted a second Gallery dialog').rejects.toThrow();
    });
});
