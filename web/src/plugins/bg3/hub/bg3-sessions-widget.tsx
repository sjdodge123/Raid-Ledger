/**
 * ROK-1958 D-9 / §3.3 — the BG3 "Session history" card body (order 46,
 * span 2): the active campaign's newest sessions (max 5, newest first) on a
 * token rail. The campaign id comes from the shared snapshot query (D-14).
 * Header action "Show all" → `#campaign` (`Bg3SeeAllAction`). Hidden by the
 * probe with no active campaign / an empty snapshot (D-10).
 */
import type { JSX } from 'react';
import type { Bg3Session } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { BG3_SESSIONS_WIDGET_LIMIT } from '../api/bg3-api';
import { useBg3Sessions, useBg3Snapshot } from '../hooks/use-bg3-hub';
import { Bg3SessionRow } from './bg3-session-row';
import { Bg3WidgetError } from './bg3-widget-error';

const PULSE = 'h-11 animate-pulse rounded-md bg-panel';

/** Newest first, capped at the widget limit (the api already orders; this keeps the card honest). */
function newestSessions(sessions: readonly Bg3Session[]): Bg3Session[] {
    return [...sessions]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, BG3_SESSIONS_WIDGET_LIMIT);
}

function SessionsLoading(): JSX.Element {
    return (
        <div className="flex flex-col gap-2" data-testid="bg3-sessions-loading">
            <div className={PULSE} /><div className={PULSE} /><div className={PULSE} />
        </div>
    );
}

export default function Bg3SessionsWidget({ page }: HubWidgetCtx): JSX.Element | null {
    const hubId = page.guild.id;
    const snapshot = useBg3Snapshot(hubId);
    const snap = snapshot.data;
    const sessions = useBg3Sessions(hubId, snap != null && !snap.empty ? snap.campaignId : null);
    if (snap === null || snap?.empty === true) return null;
    if (sessions.data) {
        const rows = newestSessions(sessions.data.sessions);
        if (rows.length === 0) return null;
        return (
            <ol className="ml-1.5 border-l-2 border-edge pl-4" aria-label="Sessions" data-testid="bg3-sessions">
                {rows.map((s, i) => <Bg3SessionRow key={`${s.lastSaveId}-${s.startedAt}`} session={s} latest={i === 0} />)}
            </ol>
        );
    }
    if (snapshot.isError || sessions.isError) {
        return <Bg3WidgetError text="Couldn't load the sessions." onRetry={() => { void snapshot.refetch(); void sessions.refetch(); }} />;
    }
    return <SessionsLoading />;
}
