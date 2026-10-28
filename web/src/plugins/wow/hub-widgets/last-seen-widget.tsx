/**
 * ROK-1916 (W9) — WoW: Forever "Last seen" Overview card body. Presence as of
 * the latest LedgerLink guild export — never "online now": the headline
 * "N online at last export" (+ "of M members in the export"), up to five
 * online names, then the five longest away. `reported === 0` (no
 * presence-bearing export yet, or one imported before this shipped) shows the
 * quiet no-export state; nobody online with no day counts is one quiet line
 * (no bare "0" headline). The shared `FreshnessFooter` dates the export from
 * `lastSeen.snapshotAt` — the guild's LedgerLink snapshot time carried in the
 * SAME response as the presence values (never the separately cached guild
 * page, never the roster's level/class fact freshness); its tooltip carries
 * the absolute time (Q4). Core draws the `WidgetCard` chrome;
 * the registration (`last-seen.register.ts`) gates it to members + staff.
 */
import type { JSX } from 'react';
import type { WowRosterLastSeenDto } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { FreshnessFooter } from './freshness-footer';
import { AwaySection, OnlineSection } from './last-seen-rows';
import { useRosterInsights } from './use-roster-insights';

/** The Last seen widget body (lazy-loaded). */
export default function LastSeenWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id, false);
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load last seen.</p>;
    const lastSeen = data.lastSeen;
    const footer = <Footer asOf={lastSeen?.snapshotAt ?? null} />;
    if (lastSeen === undefined || lastSeen.reported === 0) return <NoExport footer={footer} />;
    if (lastSeen.onlineCount === 0 && lastSeen.away.length === 0) {
        return (
            <div data-testid="last-seen-nobody" className="flex flex-col">
                <p className="text-sm text-muted">Nobody was online at the last export.</p>
                {footer}
            </div>
        );
    }
    return (
        <div data-testid="last-seen" className="flex flex-col">
            <Headline lastSeen={lastSeen} />
            <OnlineSection lastSeen={lastSeen} />
            <AwaySection away={lastSeen.away} />
            {footer}
        </div>
    );
}

/** The quiet §4.5 state before any presence-bearing export. */
function NoExport({ footer }: { footer: JSX.Element }): JSX.Element {
    return (
        <div data-testid="last-seen-empty" className="flex flex-col gap-1">
            <p className="text-sm text-muted">No online data yet.</p>
            <p className="text-xs text-dim">Shows up when an officer exports the roster from LedgerLink.</p>
            {footer}
        </div>
    );
}

function Headline({ lastSeen }: { lastSeen: WowRosterLastSeenDto }): JSX.Element {
    return (
        <>
            <p data-testid="last-seen-headline" className="flex items-baseline gap-1.5">
                <span className="text-3xl font-bold leading-none text-foreground">{lastSeen.onlineCount}</span>
                <span className="text-sm text-muted">online at last export</span>
            </p>
            <p className="mt-0.5 text-xs text-dim">of {lastSeen.reported} members in the export</p>
        </>
    );
}

/** `FreshnessFooter` dated by the guild snapshot (LedgerLink export), with its absolute time as the tooltip. */
function Footer({ asOf }: { asOf: string | null }): JSX.Element {
    if (asOf === null) return <FreshnessFooter freshness={null} />;
    const title = `Roster exported ${new Date(asOf).toLocaleString()}`;
    return <FreshnessFooter freshness={{ source: 'roster', asOf }} title={title} />;
}
