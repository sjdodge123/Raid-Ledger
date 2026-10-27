/**
 * ROK-1953 — the Core "Playtime" card body (span 1, members): lifetime Steam
 * hours per member for the hub's game, most first, each over a meter scaled
 * to the top row, and the footnote. Shown whenever the game is enabled, even
 * with no achievements (D10). Core draws the `WidgetCard`.
 * Default export so the registration can `React.lazy` it.
 */
import type { JSX } from 'react';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { useHubSteamStats } from './use-hub-steam-stats';
import { missingLine, nobodyLinked, playtimeRows } from './steam-stats.helpers';
import { SteamMemberRows, SteamStatsSkeleton } from './steam-stats-rows';
import { SteamStatsNobodyLinked, SteamStatsViewerCallout } from './steam-stats-viewer-callout';

export const STEAM_PLAYTIME_FOOTNOTE = 'Lifetime Steam hours, all playthroughs';

export default function SteamPlaytimeWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const { data, isPending } = useHubSteamStats(page.guild.id);
    if (isPending) return <SteamStatsSkeleton />;
    if (!data?.available) return null;
    const viewerStatus = data.viewer.status;
    if (nobodyLinked(data.members)) return <SteamStatsNobodyLinked viewerUnlinked={viewerStatus === 'unlinked'} />;
    const missing = missingLine(data.members, false);
    return (
        <div className="flex flex-col" data-testid="steam-playtime-body">
            <SteamMemberRows rows={playtimeRows(data.members)} label="Playtime" testId="steam-playtime-row"
                meterLabel={(r) => `${r.member.displayName}: ${r.value}`} />
            <p className="mt-2 text-xs text-muted" data-testid="steam-playtime-footnote">
                {`${STEAM_PLAYTIME_FOOTNOTE}${missing === '' ? '' : ` · ${missing}`}.`}
            </p>
            <SteamStatsViewerCallout status={viewerStatus} joinCopy="Link Steam to add your hours." />
        </div>
    );
}
