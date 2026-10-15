/**
 * ROK-1774 — Schedule (phone list) frame at ~390px. Server items are muted
 * one-line rows ("Server restart · 4:00 AM"), interleaved with events by time
 * and visually quieter than the event cards: no fill, no border, `text-dim`.
 */
import type { JSX } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import { getGameColors } from '../../constants/game-colors';
import {
  DAY_LABELS, eventsForDay, formatClock, serverItemsForDay, serverName,
  type DayServerItem, type MockEvent,
} from './server-schedule-mock';

type Row = { kind: 'event'; at: number; event: MockEvent } | { kind: 'server'; at: number; item: DayServerItem };

function rowsForDay(day: number, showServers: boolean): Row[] {
  const rows: Row[] = eventsForDay(day).map((event) => ({ kind: 'event', at: event.startMin, event }));
  if (showServers) {
    for (const item of serverItemsForDay(day)) rows.push({ kind: 'server', at: item.atMin, item });
  }
  return rows.sort((a, b) => a.at - b.at);
}

function EventRow({ event }: { event: MockEvent }): JSX.Element {
  return (
    <div data-testid="ss-list-event" className="flex gap-3 rounded-lg border border-edge bg-panel p-3">
      <span aria-hidden="true" className="w-1 shrink-0 rounded-full" style={{ backgroundColor: getGameColors(event.gameSlug).bg }} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{event.title}</div>
        <div className="text-xs text-muted">{formatClock(event.startMin)} – {formatClock(event.endMin)}</div>
      </div>
    </div>
  );
}

function ServerRow({ item }: { item: DayServerItem }): JSX.Element {
  return (
    <div data-testid="ss-list-server" className="flex items-center gap-2 px-3 py-0.5 text-xs text-dim" title={item.live}>
      <PowerIcon aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{item.short}</span>
      <span aria-hidden="true">·</span>
      <span className="truncate">{serverName(item.serverId)}</span>
    </div>
  );
}

function DaySection({ day, showServers }: { day: number; showServers: boolean }): JSX.Element | null {
  const rows = rowsForDay(day, showServers);
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h4 className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{DAY_LABELS[day] ?? ''}</h4>
      {rows.map((r) => (r.kind === 'event'
        ? <EventRow key={r.event.id} event={r.event} />
        : <ServerRow key={r.item.key} item={r.item} />))}
    </section>
  );
}

/** Phone-width schedule list for the mock week. */
export function ScheduleListPanel({ showServers }: { showServers: boolean }): JSX.Element {
  return (
    <div data-testid="ss-panel-schedule" className="w-full max-w-[390px] rounded-[1.5rem] border border-edge-strong bg-surface p-3">
      <div className="max-h-[560px] space-y-1 overflow-y-auto">
        {[0, 1, 2, 3, 4, 5, 6].map((d) => <DaySection key={d} day={d} showServers={showServers} />)}
      </div>
    </div>
  );
}
