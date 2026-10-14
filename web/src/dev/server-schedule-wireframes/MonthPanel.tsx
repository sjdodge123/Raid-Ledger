/**
 * ROK-1774 — Month frame. No bands at this zoom: one muted power glyph per day
 * that has a marker or window, whose tooltip lists them. Mock data covers the
 * week of 12–18 Oct only; the other days are empty on purpose.
 */
import type { JSX } from 'react';
import { getCalendarEventStyle } from '../../constants/game-colors';
import {
  MOCK_WEEK_FIRST_DATE, MONTH_DAYS, MONTH_FIRST_WEEKDAY, eventsForDay, serverItemsForDay,
} from './server-schedule-mock';
import { ServerGlyph } from './server-schedule-layers';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CELL_COUNT = 35;

/** Mock-week day index for a date of the month, or -1 outside the mock week. */
function mockDayFor(date: number): number {
  const idx = date - MOCK_WEEK_FIRST_DATE;
  return idx >= 0 && idx < 7 ? idx : -1;
}

function MonthCell({ date, showServers }: { date: number; showServers: boolean }): JSX.Element {
  const day = mockDayFor(date);
  const items = day >= 0 && showServers ? serverItemsForDay(day) : [];
  const events = day >= 0 ? eventsForDay(day) : [];
  return (
    <div data-testid={`ss-month-${date}`} className="min-h-[84px] border-l border-t border-edge p-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-secondary">{date}</span>
        {items.length > 0 && <ServerGlyph items={items} testId="ss-month-glyph" />}
      </div>
      <div className="mt-1 space-y-0.5">
        {events.map((e) => (
          <div key={e.id} className="truncate" style={getCalendarEventStyle(e.gameSlug)}>{e.title}</div>
        ))}
      </div>
    </div>
  );
}

/** Oct 2026, Monday-first, five rows. */
export function MonthPanel({ showServers }: { showServers: boolean }): JSX.Element {
  const cells = Array.from({ length: CELL_COUNT }, (_, i) => i - MONTH_FIRST_WEEKDAY + 1);
  return (
    <div data-testid="ss-panel-month" className="overflow-x-auto rounded-lg border border-edge bg-surface">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-l border-edge py-1.5 text-center text-xs font-medium text-muted">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-b border-r border-edge">
          {cells.map((date) => (date >= 1 && date <= MONTH_DAYS
            ? <MonthCell key={date} date={date} showServers={showServers} />
            : <div key={`pad-${date}`} className="min-h-[84px] border-l border-t border-edge bg-panel/40" />))}
        </div>
      </div>
    </div>
  );
}
