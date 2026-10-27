/**
 * Hub Gallery demo for /dev/design-system (ROK-1942, design-system §4.29).
 * Lazy-loaded by hub-widgets-section.tsx. Seeds the query cache for a demo
 * hub (id -1, never a real hub) — the list pages for every chip and a
 * generated picture per file path — so the REAL tile grid, viewer and dialog
 * render offline. Moderation buttons show the editor footer (or, "as a
 * member", only the uploader's Remove); they only toast an error here (no API
 * behind the demo hub). ROK-1965: two items are member uploads ("Uploaded"
 * caption, `canRemove`), and a states row shows Add picture, its uploading
 * progress and the empty card every member sees.
 */
import { useState, type JSX } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { HubMediaItem, HubMediaKind, HubMediaListResponse } from '@raid-ledger/contract';
import { hubMediaKeys, type HubMediaFilter } from '../../lib/hub-media-query';
import { Button } from '../../components/ui/button';
import { HubGalleryDialog } from '../../components/hub/gallery/hub-gallery-dialog';
import { HubGalleryGrid } from '../../components/hub/gallery/hub-gallery-grid';
import { useHubGalleryStore } from '../../components/hub/gallery/hub-gallery-store';
import { HubGalleryAddPicture, HubGalleryAddPictureView } from '../../components/hub/gallery/hub-gallery-add-picture';
import { HubGalleryEmpty } from '../../components/hub/gallery/hub-gallery-widget';

const HUB = -1;
const KINDS: HubMediaKind[] = ['death', 'screenshot', 'image'];
/** Member uploads by the viewer: "Uploaded" caption, Remove for the uploader. */
const UPLOADS: ReadonlySet<number> = new Set([1, 6]);

function demoItem(i: number): HubMediaItem {
    const kind = UPLOADS.has(i) ? 'upload' : (KINDS[i % 3] ?? 'image');
    return {
        id: i + 1, kind, authorName: ['Jasz', 'Brakka', null][i % 3] ?? null, caption: null,
        capturedAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(), width: 480, height: 360,
        thumbPath: `/demo/gallery/${i}/thumb`, fullPath: `/demo/gallery/${i}/full`,
        source: UPLOADS.has(i) ? { type: 'upload', label: 'Uploaded' } : { type: 'discord', label: 'Discord' },
        link: null, hidden: i === 4, canRemove: UPLOADS.has(i),
    };
}

const ITEMS = Array.from({ length: 12 }, (_, i) => demoItem(i));

/** Picture content, not UI chrome: a flat hue per item stands in for a screenshot. */
function picture(i: number): Blob {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="hsl(${(i * 47) % 360} 40% 38%)"/></svg>`;
    return new Blob([svg], { type: 'image/svg+xml' });
}

function matches(item: HubMediaItem, filter: HubMediaFilter): boolean {
    return filter === 'all' || item.kind === filter || (filter === 'screenshot' && (item.kind === 'image' || item.kind === 'upload'));
}

function seed(qc: QueryClient): void {
    qc.setQueryDefaults(hubMediaKeys.all(HUB), { staleTime: Infinity });
    ITEMS.forEach((item, i) => {
        qc.setQueryData(['hub-media', 'file', item.thumbPath], picture(i));
        qc.setQueryData(['hub-media', 'file', item.fullPath], picture(i));
    });
    for (const filter of ['all', 'death', 'screenshot'] as const) {
        const items = ITEMS.filter((it) => matches(it, filter));
        const page: HubMediaListResponse = { items, nextCursor: null, total: items.length, kinds: [...KINDS, 'upload'] };
        qc.setQueryData([...hubMediaKeys.all(HUB), 'pages', filter], { pages: [page], pageParams: [null] });
    }
}

/** ROK-1965 states: Add picture (full + phone "Add"), uploading, the member empty card. */
function UploadStates(): JSX.Element {
    const none = (): void => undefined;
    return (
        <div className="flex flex-col gap-3" data-testid="ds-hub-gallery-upload-states">
            <div className="flex flex-wrap items-center gap-3">
                <HubGalleryAddPicture guildId={HUB} inputTestId="ds-hub-gallery-add-input" />
                <HubGalleryAddPicture guildId={HUB} compact inputTestId="ds-hub-gallery-add-compact-input" />
                <HubGalleryAddPictureView uploading progress={40} onFiles={none} inputTestId="ds-hub-gallery-uploading-input" />
            </div>
            <div className="rounded-lg border border-edge bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-foreground">Gallery</span>
                    <HubGalleryAddPictureView uploading={false} progress={0} onFiles={none} inputTestId="ds-hub-gallery-empty-add-input" />
                </div>
                <HubGalleryEmpty />
            </div>
        </div>
    );
}

export default function HubGalleryDemo(): JSX.Element {
    const qc = useQueryClient();
    useState(() => { seed(qc); return true; });
    const [asMember, setAsMember] = useState(false);
    const request = useHubGalleryStore((s) => s.request);
    const openGallery = useHubGalleryStore((s) => s.openGallery);
    const open = (member: boolean, el: HTMLElement): void => {
        setAsMember(member);
        openGallery({ guildId: HUB, mode: 'grid', filter: 'all', index: 0, returnFocus: el });
    };
    return (
        <div className="flex flex-col gap-3" data-testid="ds-hub-gallery">
            <HubGalleryGrid items={ITEMS.slice(0, 8)} total={ITEMS.length}
                onOpen={(index) => openGallery({ guildId: HUB, mode: 'viewer', filter: 'all', index, returnFocus: null })} />
            <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={(e) => open(false, e.currentTarget)}>Open See all</Button>
                <Button variant="secondary" onClick={(e) => open(true, e.currentTarget)}>Open as a member</Button>
            </div>
            <UploadStates />
            {request?.guildId === HUB && <HubGalleryDialog request={request} canEdit={!asMember} />}
        </div>
    );
}
