/**
 * ROK-1958 D-8 / §3.2 — the BG3 "Where we are" card body (order 41, span 1).
 * Fed by the ONE snapshot query Party also reads (D-14). Screenshot (16:9
 * media well, collapses on a failed fetch or `onError`), "Act N · <area>", a
 * neutral difficulty chip, "Saved <relative> by <uploader>" and the patch
 * footnote. No
 * Honour badge (Q7). Spoilers on → one line replaces image + area. With no
 * active campaign / an empty snapshot the probe hides the card (D-10).
 */
import { useState, type JSX } from 'react';
import { bg3DifficultyDisplay, bg3LevelDisplay, type Bg3Snapshot } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { useHubMediaImageUrl } from '../../../hooks/use-hub-media-image';
import { syncedAgo } from '../../../lib/synced-ago';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useBg3Snapshot } from '../hooks/use-bg3-hub';
import { Bg3WidgetError } from './bg3-widget-error';

const BG3_SPOILERS_LINE = 'Location and screenshots are hidden on this hub.';

/** "Act 2 · Shadow-Cursed Lands"; the area alone when the level has no act. */
function bg3PlaceLabel(area: string): string {
    const { act, label } = bg3LevelDisplay(area);
    return act === null ? label : `Act ${act} · ${label}`;
}

function difficultyText(snap: Bg3Snapshot): string {
    const d = bg3DifficultyDisplay(snap.difficulty, snap.ruleset);
    return d.ruleset === null ? d.label : `${d.label} · ${d.ruleset}`;
}

/** "4.1.1.7631656" + "Steam" → "Patch 4.1.1 · Steam". */
function patchLine(snap: Bg3Snapshot): string {
    return `Patch ${snap.gameVersion.split('.').slice(0, 3).join('.')} · ${snap.platform}`;
}

function absoluteTime(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function Screenshot({ path }: { path: string }): JSX.Element | null {
    const url = useHubMediaImageUrl(path);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    if (url === null || failedUrl === url) return null;
    return (
        <div className="relative mb-2.5 aspect-video overflow-hidden rounded-md bg-media-well" data-testid="bg3-where-shot">
            <img src={url} alt="Latest save screenshot" loading="lazy" onError={() => setFailedUrl(url)}
                className="absolute inset-0 h-full w-full object-cover" />
        </div>
    );
}

function WhereBody({ snap }: { snap: Bg3Snapshot }): JSX.Element {
    const name = snap.uploader?.displayName ?? null;
    return (
        <div className="flex flex-col" data-testid="bg3-where">
            {snap.spoilersHidden
                ? <p className="mb-2.5 text-sm text-muted">{BG3_SPOILERS_LINE}</p>
                : <>
                    {snap.thumbnailUrl !== null && <Screenshot path={snap.thumbnailUrl} />}
                    {snap.area !== null && <p className="text-base font-semibold text-foreground" data-testid="bg3-where-place">{bg3PlaceLabel(snap.area)}</p>}
                </>}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
                <StatusChip tone="neutral" title="Difficulty">{difficultyText(snap)}</StatusChip>
            </div>
            <p className="mt-2 text-sm text-muted" title={absoluteTime(snap.savedAt)}>
                Saved {syncedAgo(snap.savedAt)}{name === null ? '' : ` by ${name}`}
            </p>
            <p className="mt-0.5 text-xs text-dim">{patchLine(snap)}</p>
        </div>
    );
}

function WhereLoading(): JSX.Element {
    return (
        <div className="flex flex-col gap-2" data-testid="bg3-where-loading">
            <div className="aspect-video animate-pulse rounded-md bg-panel" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-panel" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-panel" />
        </div>
    );
}

export default function Bg3WhereWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const snapshot = useBg3Snapshot(page.guild.id);
    const snap = snapshot.data;
    if (snap != null && !snap.empty) return <WhereBody snap={snap} />;
    if (snapshot.isPending) return <WhereLoading />;
    if (snapshot.isError) return <Bg3WidgetError text="Couldn't load where the party is." onRetry={() => void snapshot.refetch()} />;
    return null;
}
