/**
 * ROK-1876 L3 / ROK-1877 L2 — the server hub's "Server hours" Overview widget:
 * the live state first and the schedule second (a tone dot, "Online now ·
 * until 10:00 PM", an optional muted second line), the merged weekly rows
 * ("Every day", "Mon–Fri"), then the muted start / stop / restart lines.
 * Every viewer sees it (operator ruling 2026-10-21). WidgetCard + list rows +
 * the restart-line idiom, tokens only, so both colour families follow the theme.
 */
import { useMemo, type JSX } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import type { HubCtx } from '../../hub-module';
import { WidgetCard } from '../../../components/hub/hub-bits';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { SERVER_HOURS_EMPTY, buildServerHours, type NowModel, type NowTone, type ServerHours } from './server-hours.helpers';
import type { WeekRow } from './server-hours-week.helpers';
import { useServerHours } from './use-server-hours';

/** The dot carries the tone; only "Online now" also takes the success text colour (mockup S1–S8). */
const DOT_CLASS: Record<NowTone, string> = { online: 'bg-success', warn: 'bg-warning', offline: 'bg-faint', neutral: 'bg-faint' };

/** The now line plus its optional sub-line, 4px apart in their own column (mockup S3: 12px card gap − 8px); no negative margin, since the card body has no gap to borrow from (Codex r2). */
function NowLine({ now }: { now: NowModel }): JSX.Element {
    const headClass = now.tone === 'online' ? 'text-success' : 'text-foreground';
    return (
        <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground" data-testid="server-hub-hours-now">
                <span aria-hidden="true" data-testid="server-hub-hours-dot" data-tone={now.tone} className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[now.tone]}`} />
                <span className={headClass}>{now.head}</span>
                {now.tail !== null && <>{' '}<span className="font-normal text-secondary">· {now.tail}</span></>}
            </p>
            {now.sub !== null && <p className="pl-4 text-xs text-muted" data-testid="server-hub-hours-sub">{now.sub}</p>}
        </div>
    );
}

function WeekList({ rows }: { rows: readonly WeekRow[] }): JSX.Element | null {
    if (rows.length === 0) return null;
    return (
        <ul className="divide-y divide-edge-subtle" data-testid="server-hub-hours-days">
            {rows.map((r) => (
                <li key={r.key} data-testid="server-hub-hours-row" data-day-label={r.label} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="shrink-0 font-medium text-foreground">{r.label}</span>
                    <span className="min-w-0 text-right text-secondary">{r.spans}</span>
                </li>
            ))}
        </ul>
    );
}

function Muted({ testId, text }: { testId: string; text: string }): JSX.Element {
    return <p className="py-2 text-sm text-muted" data-testid={testId}>{text}</p>;
}

function Body({ hours }: { hours: ServerHours }): JSX.Element {
    if (hours.empty) return <Muted testId="server-hub-hours-empty" text={SERVER_HOURS_EMPTY} />;
    return <WeekList rows={hours.weekRows} />;
}

/** One muted power line (start / stop / restart) in the ROK-1876 restart-line idiom. */
function PowerLine({ testId, text }: { testId: string; text: string | null }): JSX.Element | null {
    if (text === null) return null;
    return (
        <p className="flex items-center gap-1.5 text-xs text-dim" data-testid={testId}>
            <PowerIcon aria-hidden="true" className="h-4 w-4 shrink-0" />{text}
        </p>
    );
}

/** Overview widget body; registered visible only on a hub with a server block. */
export function ServerHoursWidget({ page }: HubCtx): JSX.Element | null {
    const server = page.server;
    const tz = useTimezoneStore((s) => s.resolved);
    const { query, now } = useServerHours(server !== undefined);
    const items = query.data;
    const hours = useMemo(() => (server === undefined ? null
        : buildServerHours({ items: items ?? [], pelicanServerId: server.pelicanServerId, state: server.state, now, tz })), [server, items, now, tz]);
    if (hours === null) return null;
    const settled = !query.isPending && !query.isError;
    return (
        <WidgetCard id="server-hub-hours" title="Server hours">
            <NowLine now={hours.now} />
            {query.isPending && <Muted testId="server-hub-hours-loading" text="Loading hours…" />}
            {query.isError && <Muted testId="server-hub-hours-error" text="Couldn’t load the hours" />}
            {settled && <Body hours={hours} />}
            {settled && <PowerLine testId="server-hub-hours-start" text={hours.startLine} />}
            {settled && <PowerLine testId="server-hub-hours-stop" text={hours.stopLine} />}
            <PowerLine testId="server-hub-hours-restart" text={hours.restartLine} />
        </WidgetCard>
    );
}
