/**
 * ROK-1953 §5.2 — the per-viewer line under a Steam card (unlinked → Link
 * Steam, private → the warning copy, pending → tonight's refresh) and the
 * §4.5 empty state when nobody on the hub has linked Steam.
 */
import type { JSX } from 'react';
import type { SteamStatsStatus } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { useSteamLink } from '../../../hooks/use-steam-link';

export const STEAM_PRIVATE_COPY =
    "Your Steam game details are private — set Game Details to Public in Steam's privacy settings.";
export const STEAM_PENDING_COPY = "Your Steam stats arrive with tonight's refresh.";
export const STEAM_NOBODY_LINKED_COPY = 'No one here has linked Steam yet.';

function LinkSteamButton(): JSX.Element {
    const { linkSteam, isLinkPending } = useSteamLink();
    return (
        <Button variant="secondary" size="sm" loading={isLinkPending} onClick={() => linkSteam()} data-testid="steam-stats-link">
            Link Steam
        </Button>
    );
}

/** The viewer's own Steam line; `joinCopy` is the card's unlinked prompt. Nothing for `ok` / other statuses. */
export function SteamStatsViewerCallout({ status, joinCopy }: { status: SteamStatsStatus; joinCopy: string }): JSX.Element | null {
    if (status === 'unlinked') {
        return (
            <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted" data-testid="steam-stats-callout">
                <span>{joinCopy}</span>
                <LinkSteamButton />
            </div>
        );
    }
    if (status === 'private') return <p className="mt-3 text-sm text-warning" data-testid="steam-stats-callout">{STEAM_PRIVATE_COPY}</p>;
    if (status === 'pending') return <p className="mt-3 text-sm text-muted" data-testid="steam-stats-callout">{STEAM_PENDING_COPY}</p>;
    return null;
}

/** §4.5 — nobody linked; the Link Steam button only for a viewer who has not linked either. */
export function SteamStatsNobodyLinked({ viewerUnlinked }: { viewerUnlinked: boolean }): JSX.Element {
    return (
        <div className="flex flex-col items-center gap-3 py-6 text-center" data-testid="steam-stats-empty">
            <p className="text-sm text-muted">{STEAM_NOBODY_LINKED_COPY}</p>
            {viewerUnlinked && <LinkSteamButton />}
        </div>
    );
}
