/** ROK-1958 V-5 + the Where/History half of V-7 — the BG3 "Where we are" card and the snapshot probe. */
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { BG3_URL, bg3CampaignsHandler, bg3SnapshotHandler } from '../../../test/mocks/bg3-handlers';
import {
    BG3_CAMPAIGN_ID, BG3_HUB_ID, buildBg3CampaignsResponse, buildBg3HiddenSnapshot, buildBg3Snapshot,
} from '../../../test/factories/bg3';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { bg3Keys } from '../hooks/bg3-keys';
import { useBg3SnapshotVisible } from '../hooks/use-bg3-visible';
import Bg3WhereWidget from './bg3-where-widget';

const auth = vi.hoisted(() => ({ user: { id: 33, username: 'thistle', displayName: 'Thistle', role: 'member' } }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: auth.user }),
}));

const THUMB_URL = `${BG3_URL}/hubs/:hubId/saves/:saveId/thumbnail`;

function ctx(): HubWidgetCtx {
    const page = { guild: { id: BG3_HUB_ID }, viewer: { role: 'member', canEdit: false, canManageEditors: false } } as GuildPage;
    // The widgets read only `page.guild.id` and `page.viewer.role` (register.test idiom).
    return { page, gameSlug: 'baldurs-gate-3' } as HubWidgetCtx;
}

function serve(snapshot: Parameters<typeof bg3SnapshotHandler>[0] = buildBg3Snapshot()): void {
    server.use(bg3CampaignsHandler(buildBg3CampaignsResponse()), bg3SnapshotHandler(snapshot));
}

async function renderWhere(): Promise<HTMLElement> {
    renderWithProviders(<Bg3WhereWidget {...ctx()} />);
    return screen.findByTestId('bg3-where');
}

beforeEach(() => {
    server.use(http.get(THUMB_URL, () => new HttpResponse(new Blob(['webp'], { type: 'image/webp' }))));
});
/** jsdom has no object URLs; the shared media hook then never draws an image. */
function stubObjectUrl(): void {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:thumb'), revokeObjectURL: vi.fn() });
}
afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('Bg3WhereWidget (V-5)', () => {
    it('shows "Act 2 · <area>", the Tactician chip, who saved it and the patch line', async () => {
        serve();
        const card = await renderWhere();
        expect(screen.getByTestId('bg3-where-place')).toHaveTextContent(/^Act 2 · Shadow-Cursed Lands$/);
        expect(screen.getByTitle('Difficulty')).toHaveTextContent(/^Tactician$/);
        expect(card).toHaveTextContent(/Saved .+ ago by Moonwhisper/);
        expect(card).toHaveTextContent('Patch 4.1.1 · Steam');
    });

    it('names an uploader who holds no claim, and shows a non-act area alone', async () => {
        serve(buildBg3Snapshot({
            uploaderUserId: 99, uploader: { userId: 99, displayName: 'Quillfeather' }, area: 'SYS_Menuscreen_Camp_A',
        }));
        const card = await renderWhere();
        expect(screen.getByTestId('bg3-where-place')).toHaveTextContent(/^Camp$/);
        expect(card).toHaveTextContent(/Saved .+ ago by Quillfeather/);
    });

    it('drops " by …" when the uploader is unknown (user row gone)', async () => {
        serve(buildBg3Snapshot({ uploaderUserId: 99, uploader: null }));
        const card = await renderWhere();
        expect(card).toHaveTextContent(/Saved .+ ago/);
        expect(card).not.toHaveTextContent(/ by /);
    });

    it('spoilers on: one line replaces the image and the area; difficulty and saved time stay', async () => {
        serve(buildBg3HiddenSnapshot());
        const card = await renderWhere();
        expect(card).toHaveTextContent('Location and screenshots are hidden on this hub.');
        expect(screen.queryByTestId('bg3-where-place')).toBeNull();
        expect(screen.queryByTestId('bg3-where-shot')).toBeNull();
        expect(screen.getByTitle('Difficulty')).toHaveTextContent('Tactician');
        expect(card).toHaveTextContent(/Saved .+ ago/);
    });

    it('renders the screenshot, and its onError collapses the slot', async () => {
        stubObjectUrl();
        serve();
        await renderWhere();
        const img = await screen.findByRole('img', { name: 'Latest save screenshot' });
        expect(img).toHaveAttribute('src', 'blob:thumb');
        fireEvent.error(img);
        expect(screen.queryByTestId('bg3-where-shot')).toBeNull();
        expect(screen.getByTestId('bg3-where-place')).toBeInTheDocument();
    });

    it('a thumbnail fetch failure never draws the slot', async () => {
        stubObjectUrl();
        const hits = vi.fn();
        server.use(http.get(THUMB_URL, () => { hits(); return new HttpResponse(null, { status: 404 }); }));
        serve();
        await renderWhere();
        await waitFor(() => expect(hits).toHaveBeenCalled());
        expect(screen.queryByTestId('bg3-where-shot')).toBeNull();
    });
});

function Probe(props: HubWidgetCtx): JSX.Element {
    return <span data-testid="probe">{String(useBg3SnapshotVisible(props))}</span>;
}

async function probeAfterSnapshot(): Promise<string | null> {
    const { queryClient } = renderWithProviders(<Probe {...ctx()} />);
    await waitFor(() => expect(queryClient.getQueryState(bg3Keys.snapshot(BG3_HUB_ID))?.status).toMatch(/success/));
    return screen.getByTestId('probe').textContent;
}

describe('Where we are / Session history probe (V-7)', () => {
    it('is visible with a non-empty snapshot', async () => {
        serve();
        renderWithProviders(<Probe {...ctx()} />);
        await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^true$/));
    });

    it('hides on an empty snapshot', async () => {
        serve({ empty: true, campaignId: BG3_CAMPAIGN_ID });
        expect(await probeAfterSnapshot()).toBe('false');
    });

    it('hides with no active campaign (snapshot 404 no_campaign)', async () => {
        serve('no-campaign');
        expect(await probeAfterSnapshot()).toBe('false');
    });

    it('the Where body renders nothing on an empty snapshot', async () => {
        serve({ empty: true, campaignId: BG3_CAMPAIGN_ID });
        const { container, queryClient } = renderWithProviders(<Bg3WhereWidget {...ctx()} />);
        await waitFor(() => expect(queryClient.getQueryState(bg3Keys.snapshot(BG3_HUB_ID))?.status).toBe('success'));
        expect(container).toBeEmptyDOMElement();
    });
});
