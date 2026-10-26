/** ROK-1941 (Q1 = A) — the Deaths card's per-player picture strip: up to 3 thumbs + "+N", outside the row link, opening the Gallery on Deaths. */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { hubMediaFileHandler } from '../../../test/mocks/hub-media-handlers';
import { valheimDeathsHandler, valheimDeathsPicturesFixture } from '../../../test/mocks/valheim-deaths-handlers';
import { useHubGalleryStore } from '../../../components/hub/gallery/hub-gallery-store';
import { useTimezoneStore } from '../../../stores/timezone-store';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import ValheimDeathsWidget from './valheim-deaths-widget';

function ctx(): HubWidgetCtx {
    const page = {
        guild: { id: 5 },
        server: { pelicanServerId: 7, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: false },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    // The widget reads only `page.guild.id` and `page.server` (register.test idiom).
    return { page, gameSlug: 'valheim' } as HubWidgetCtx;
}

const Widget = (): JSX.Element => <ValheimDeathsWidget {...ctx()} />;
const rowOf = (key: string): HTMLElement => {
    const row = screen.getAllByTestId('valheim-deaths-row').find((r) => r.dataset.key === key);
    if (row === undefined) throw new Error(`no Deaths row ${key}`);
    return row;
};
const strip = (name: string): HTMLElement => screen.getByRole('group', { name: `${name}'s death pictures` });

beforeEach(() => {
    useTimezoneStore.setState({ resolved: 'UTC' });
    useHubGalleryStore.setState({ filters: {}, request: null });
    server.use(hubMediaFileHandler, valheimDeathsHandler(valheimDeathsPicturesFixture));
});

describe('ValheimDeathsWidget — picture strip', () => {
    it('draws the served thumbs newest first plus "+N" for the rest, named like a Gallery tile', async () => {
        renderWithProviders(<Widget />);
        const group = await screen.findByRole('group', { name: "Ragnhild's death pictures" });
        const buttons = within(group).getAllByRole('button');
        expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
            'Death — Ragnhild, 1 day ago. Open picture',
            'Death — Ragnhild, 1 day ago. Open picture',
            'Death — Ragnhild, 2 days ago. Open picture',
            '2 more death pictures. Open the gallery',
        ]);
        expect(within(group).getByText('+2')).toBeTruthy();
    });

    it('sits outside the row map link (no nested interactive) and keeps the link as the row text', async () => {
        renderWithProviders(<Widget />);
        const link = await screen.findByRole('link', { name: 'Ragnhild, 12 deaths — show on map' });
        await waitFor(() => expect(strip('Ragnhild')).toBeTruthy());
        expect(link.contains(strip('Ragnhild'))).toBe(false);
        expect(within(link).queryByRole('button')).toBeNull();
        expect(rowOf('c11').contains(strip('Ragnhild'))).toBe(true);
    });

    it('no "+N" when every picture is served; a row with no pictures draws no strip', async () => {
        renderWithProviders(<Widget />);
        const group = await screen.findByRole('group', { name: "Hrafn's death pictures" });
        expect(within(group).getAllByRole('button')).toHaveLength(1);
        expect(within(rowOf('nLeft-the-hub')).queryByRole('group')).toBeNull();
        expect(within(rowOf('nLeft-the-hub')).queryByRole('button')).toBeNull();
    });

    it('a thumb opens the Gallery viewer at that picture with the Deaths chip on', async () => {
        renderWithProviders(<Widget />);
        const group = await screen.findByRole('group', { name: "Ragnhild's death pictures" });
        const second = within(group).getAllByRole('button')[1];
        if (second === undefined) throw new Error('no second thumb');
        fireEvent.click(second);
        expect(useHubGalleryStore.getState().request).toMatchObject({ guildId: 5, mode: 'viewer', filter: 'death', mediaId: 40 });
        expect(useHubGalleryStore.getState().request?.returnFocus).toBe(second);
    });

    it('"+N" opens the Gallery grid with the Deaths chip on', async () => {
        renderWithProviders(<Widget />);
        fireEvent.click(await screen.findByRole('button', { name: '2 more death pictures. Open the gallery' }));
        expect(useHubGalleryStore.getState().request).toMatchObject({ guildId: 5, mode: 'grid', filter: 'death' });
    });
});
