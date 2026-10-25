/**
 * ROK-1953 — the Core "Achievement race" card body (span 1, members): each
 * linked member's `X / Y` over a meter, the 4 most recent unlocks, the rarest
 * unlock and a footnote (missing members, co-op caveat, last refresh). Hidden
 * achievements the viewer has not earned arrive masked from the server and
 * render as "Hidden achievement" + % only. Core draws the `WidgetCard`.
 * Default export so the registration can `React.lazy` it.
 */
import type { JSX } from 'react';
import type { SteamHubMemberStats, SteamHubUnlock } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';
import { syncedAgo } from '../../../lib/synced-ago';
import { useHubSteamStats } from './use-hub-steam-stats';
import { achievementName, missingLine, nobodyLinked, pctLabel, raceRows } from './steam-stats.helpers';
import { SteamMemberRows, SteamStatsSkeleton, SteamUnlockRow } from './steam-stats-rows';
import { SteamStatsNobodyLinked, SteamStatsViewerCallout } from './steam-stats-viewer-callout';

/** Recent unlocks shown on the card (the route sends up to 8). */
export const STEAM_RECENT_UNLOCKS_SHOWN = 4;
export const STEAM_COOP_CAVEAT = "Steam counts unlocks per player, so co-op partners don't always get them.";

type MemberLookup = (userId: number) => SteamHubMemberStats | undefined;

function RecentUnlocks({ unlocks, memberOf }: { unlocks: readonly SteamHubUnlock[]; memberOf: MemberLookup }): JSX.Element | null {
    if (unlocks.length === 0) return null;
    return (
        <section aria-label="Recent unlocks">
            <h4 className="mb-1 mt-3 text-xs font-semibold uppercase text-muted">Recent unlocks</h4>
            <ul className="flex flex-col">
                {unlocks.slice(0, STEAM_RECENT_UNLOCKS_SHOWN).map((u) => (
                    <SteamUnlockRow key={`${u.userId}-${u.unlockedAt}`} unlock={u} member={memberOf(u.userId)} />
                ))}
            </ul>
        </section>
    );
}

function rarestLine(unlock: SteamHubUnlock, member: SteamHubMemberStats | undefined): string {
    const pct = pctLabel(unlock.achievement.globalPct);
    const who = member ? ` — ${member.displayName}` : '';
    return `Rarest: ${achievementName(unlock.achievement)}${pct === '' ? '' : ` · ${pct}`}${who}`;
}

function footnote(members: readonly SteamHubMemberStats[], refreshedAt: string | null): string {
    const missing = missingLine(members, true);
    const updated = refreshedAt === null ? '' : ` Updated ${syncedAgo(refreshedAt)}.`;
    return `${missing === '' ? '' : `${missing}. `}${STEAM_COOP_CAVEAT}${updated}`;
}

export default function SteamAchievementsWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const { data, isPending } = useHubSteamStats(page.guild.id);
    if (isPending) return <SteamStatsSkeleton />;
    if (!data?.available || data.totalAchievements === 0) return null;
    const viewerStatus = data.viewer.status;
    if (nobodyLinked(data.members)) return <SteamStatsNobodyLinked viewerUnlinked={viewerStatus === 'unlinked'} />;
    const byId = new Map(data.members.map((m) => [m.userId, m]));
    const memberOf: MemberLookup = (id) => byId.get(id);
    const total = data.totalAchievements;
    return (
        <div className="flex flex-col" data-testid="steam-achievements-body">
            <SteamMemberRows rows={raceRows(data.members, total)} label="Achievement race" testId="steam-race-row"
                meterLabel={(r) => `${r.member.displayName}: ${r.member.unlockedCount ?? 0} of ${total} achievements`} />
            <RecentUnlocks unlocks={data.recentUnlocks} memberOf={memberOf} />
            {data.rarestUnlock && (
                <p className="mt-2 text-xs text-muted" data-testid="steam-rarest">{rarestLine(data.rarestUnlock, memberOf(data.rarestUnlock.userId))}</p>
            )}
            <p className="mt-2 text-xs text-muted" data-testid="steam-achievements-footnote">{footnote(data.members, data.refreshedAt)}</p>
            <SteamStatsViewerCallout status={viewerStatus} joinCopy="Link Steam to join the race." />
        </div>
    );
}
