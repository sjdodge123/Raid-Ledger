/**
 * ROK-1876 L3 — the server hub's "Server hours" Overview widget: the live
 * state with the open window's close (or the next open), one row per day
 * for the next seven days in the viewer's timezone, and the next restart.
 * Every viewer sees it (operator ruling 2026-10-21). WidgetCard + list rows,
 * tokens only, so both colour families follow the theme.
 */
import { useMemo, type JSX } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import type { HubCtx } from '../../hub-module';
import { WidgetCard } from '../../../components/hub/hub-bits';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { SERVER_HOURS_EMPTY, buildServerHours, type ServerHoursDay } from './server-hours.helpers';
import { useServerHours } from './use-server-hours';

function DayRows({ days }: { days: readonly ServerHoursDay[] }): JSX.Element {
    if (days.length === 0) return <p className="py-2 text-sm text-muted" data-testid="server-hub-hours-empty">{SERVER_HOURS_EMPTY}</p>;
    return (
        <ul className="divide-y divide-edge-subtle" data-testid="server-hub-hours-days">
            {days.map((d) => (
                <li key={d.key} data-testid="server-hub-hours-row" className="flex items-baseline justify-between gap-3 py-2 text-sm">
                    <span className="shrink-0 font-medium text-foreground">{d.day}</span>
                    <span className="min-w-0 text-right text-secondary">{d.spans}</span>
                </li>
            ))}
        </ul>
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
    return (
        <WidgetCard id="server-hub-hours" title="Server hours">
            <p className="text-sm font-medium text-foreground" data-testid="server-hub-hours-now">{hours.nowLine}</p>
            {query.isPending
                ? <p className="py-2 text-sm text-muted" data-testid="server-hub-hours-loading">Loading hours…</p>
                : query.isError
                    ? <p className="py-2 text-sm text-muted" data-testid="server-hub-hours-error">Couldn’t load the hours</p>
                    : <DayRows days={hours.days} />}
            {hours.restartLine !== null && (
                <p className="flex items-center gap-1.5 text-xs text-dim" data-testid="server-hub-hours-restart">
                    <PowerIcon aria-hidden="true" className="h-4 w-4 shrink-0" />{hours.restartLine}
                </p>
            )}
        </WidgetCard>
    );
}
