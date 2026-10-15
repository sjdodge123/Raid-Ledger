/**
 * ROK-1774 — Week and Day frames. Static markup approximating the real
 * react-big-calendar time grid (`components/calendar/calendar-styles.css`):
 * an hour gutter, one column per day, hairline hour rules, events on top.
 *
 * Layer order inside a column, bottom to top: hour rules → window bands
 * (`z-0`) → events (`z-10`) → marker ticks (`z-20`).
 */
import type { JSX } from 'react';
import { getCalendarEventStyle } from '../../constants/game-colors';
import {
  DAY_LABELS, eventsForDay, formatClock, markersForDay, segmentsForDay, type MockEvent,
} from './server-schedule-mock';
import { MarkerTick, WindowBand } from './server-schedule-layers';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const GRID_HEIGHT_PX = 576; // 24px per hour

/** Event card — game colour from the same helper the real calendar uses. */
function EventBlock({ event }: { event: MockEvent }): JSX.Element {
  return (
    <button
      type="button"
      data-testid="ss-event"
      className="absolute inset-x-1 z-10 overflow-hidden text-left shadow-sm"
      style={{
        ...getCalendarEventStyle(event.gameSlug),
        top: `${(event.startMin / 1440) * 100}%`,
        height: `${((event.endMin - event.startMin) / 1440) * 100}%`,
      }}
    >
      <span className="block truncate font-semibold">{event.title}</span>
      <span className="block truncate opacity-80">{formatClock(event.startMin)} – {formatClock(event.endMin)}</span>
    </button>
  );
}

function HourRules(): JSX.Element {
  return (
    <>
      {HOURS.map((h) => (
        <div key={h} aria-hidden="true" className="absolute inset-x-0 border-t border-edge-subtle"
          style={{ top: `${(h / 24) * 100}%` }} />
      ))}
    </>
  );
}

function DayColumn({ day, showServers }: { day: number; showServers: boolean }): JSX.Element {
  return (
    <div className="relative min-w-0 border-l border-edge" style={{ height: GRID_HEIGHT_PX }}>
      <HourRules />
      {showServers && segmentsForDay(day).map((s) => (
        <WindowBand key={`${s.serverId}-${s.startMin}`} segment={s} />
      ))}
      {eventsForDay(day).map((e) => <EventBlock key={e.id} event={e} />)}
      {showServers && markersForDay(day).map((m) => (
        <MarkerTick key={`${m.serverId}-${m.atMin}`} marker={m} />
      ))}
    </div>
  );
}

function HourGutter(): JSX.Element {
  return (
    <div className="relative w-14 shrink-0" style={{ height: GRID_HEIGHT_PX }} aria-hidden="true">
      {HOURS.filter((h) => h % 2 === 0).map((h) => (
        <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted"
          style={{ top: `${(h / 24) * 100}%` }}>
          {h === 0 ? '' : formatClock(h * 60).replace(':00', '')}
        </span>
      ))}
    </div>
  );
}

function DayHeaders({ days }: { days: number[] }): JSX.Element {
  return (
    <div className="flex border-b border-edge">
      <div className="w-14 shrink-0" />
      <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
        {days.map((d) => (
          <div key={d} className="border-l border-edge py-2 text-center text-xs font-medium text-secondary">
            {DAY_LABELS[d] ?? ''}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A time grid over `days` — seven for Week, one for Day. */
export function TimeGridPanel({ days, showServers, testId, minWidth }: {
  days: number[];
  showServers: boolean;
  testId: string;
  minWidth: number;
}): JSX.Element {
  return (
    <div data-testid={testId} className="overflow-x-auto rounded-lg border border-edge bg-surface">
      <div style={{ minWidth }}>
        <DayHeaders days={days} />
        <div className="flex">
          <HourGutter />
          <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => <DayColumn key={d} day={d} showServers={showServers} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
