/**
 * ROK-1774 — mock week for the server-schedule wireframe. Static data only:
 * nothing here talks to the API or to Pelican.
 *
 * Times are minutes from 00:00 of a day index (0 = Mon 12 Oct 2026 … 6 = Sun
 * 18 Oct 2026). A `window` may end past 1440 (it crosses midnight); the grid
 * splits it per day with `segmentsForDay`.
 */

export interface MockServer {
  id: string;
  name: string;
  /** Live state line shown in every tooltip. */
  live: string;
}

export interface MockWindow {
  kind: 'window';
  serverId: string;
  day: number;
  startMin: number;
  /** May exceed 1440 — the window runs into the next day. */
  endMin: number;
}

export interface MockMarker {
  kind: 'marker';
  serverId: string;
  day: number;
  atMin: number;
  /** `restart` = a scheduled restart; `stop` = a stop with no matching start. */
  action: 'restart' | 'stop';
}

export interface MockEvent {
  id: string;
  title: string;
  gameSlug: string;
  day: number;
  startMin: number;
  endMin: number;
}

export const DAY_LABELS = ['Mon 12', 'Tue 13', 'Wed 14', 'Thu 15', 'Fri 16', 'Sat 17', 'Sun 18'] as const;
/** The day the Day panel shows (Sat 17 — Friday's window tail, the restart, a window under an event). */
export const DAY_PANEL_INDEX = 5;
/** Month grid: 1 Oct 2026 is a Thursday (index 3 in a Mon-first week). */
export const MONTH_FIRST_WEEKDAY = 3;
export const MONTH_DAYS = 31;
/** Day-of-month of day index 0 of the mock week. */
export const MOCK_WEEK_FIRST_DATE = 12;

export const SERVERS: MockServer[] = [
  { id: 'valheim', name: 'Valheim Dedicated', live: 'Online · checked 2 min ago' },
  { id: 'minecraft', name: 'Minecraft — Survival', live: 'Offline · checked 5 min ago' },
];

const NIGHTLY_RESTARTS: MockMarker[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  kind: 'marker', serverId: 'valheim', day, atMin: 4 * 60, action: 'restart',
}));

export const MARKERS: MockMarker[] = [
  ...NIGHTLY_RESTARTS,
  { kind: 'marker', serverId: 'minecraft', day: 6, atMin: 23 * 60, action: 'stop' },
];

/** Minecraft evening windows, 18:00 → 02:00 next day. */
export const WINDOWS: MockWindow[] = [2, 4, 5].map((day) => ({
  kind: 'window', serverId: 'minecraft', day, startMin: 18 * 60, endMin: 26 * 60,
}));

export const EVENTS: MockEvent[] = [
  { id: 'e1', title: 'Molten Core — weekly', gameSlug: 'wow', day: 2, startMin: 21 * 60, endMin: 23 * 60 },
  { id: 'e2', title: 'Build night — sky bridge', gameSlug: 'minecraft', day: 4, startMin: 19 * 60, endMin: 22 * 60 },
  { id: 'e3', title: 'Bonemass attempt', gameSlug: 'valheim', day: 5, startMin: 20 * 60, endMin: 23 * 60 + 30 },
];

/** One drawable piece of a window inside a single day column. */
export interface WindowSegment {
  serverId: string;
  startMin: number;
  endMin: number;
  /** True for the 00:00 piece of a window that began the day before. */
  continued: boolean;
}

/** Split every window into the pieces that fall inside `day`, earliest first (DOM order = time order). */
export function segmentsForDay(day: number, windows: MockWindow[] = WINDOWS): WindowSegment[] {
  const out: WindowSegment[] = [];
  for (const w of windows) {
    if (w.day === day) {
      out.push({ serverId: w.serverId, startMin: w.startMin, endMin: Math.min(w.endMin, 1440), continued: false });
    }
    if (w.day === day - 1 && w.endMin > 1440) {
      out.push({ serverId: w.serverId, startMin: 0, endMin: w.endMin - 1440, continued: true });
    }
  }
  return out.sort((a, b) => a.startMin - b.startMin);
}

export function markersForDay(day: number): MockMarker[] {
  return MARKERS.filter((m) => m.day === day);
}

export function eventsForDay(day: number): MockEvent[] {
  return EVENTS.filter((e) => e.day === day);
}

export function serverName(id: string): string {
  return SERVERS.find((s) => s.id === id)?.name ?? id;
}

export function serverLive(id: string): string {
  return SERVERS.find((s) => s.id === id)?.live ?? 'State unknown';
}

/** 240 → "4:00 AM"; 1080 → "6:00 PM"; wraps past midnight. */
export function formatClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  const suffix = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${suffix}`;
}

export function markerVerb(m: MockMarker): string {
  return m.action === 'restart' ? 'Restart' : 'Stop';
}

/** Tooltip copy: "Restart · Valheim Dedicated · 4:00 AM". */
export function markerTooltip(m: MockMarker): string {
  return `${markerVerb(m)} · ${serverName(m.serverId)} · ${formatClock(m.atMin)}`;
}

/** Tooltip copy for a window: "Server up · Minecraft — Survival · 6:00 PM – 2:00 AM". */
export function windowTooltip(w: { serverId: string; startMin: number; endMin: number }): string {
  return `Server up · ${serverName(w.serverId)} · ${formatClock(w.startMin)} – ${formatClock(w.endMin)}`;
}

/** A server item that starts on a given day, in time order (Month tooltip, Schedule rows). */
export interface DayServerItem {
  key: string;
  atMin: number;
  /** Tooltip / row headline, e.g. "Restart · Valheim Dedicated · 4:00 AM". */
  title: string;
  /** Short row copy, e.g. "Server restart · 4:00 AM". */
  short: string;
  serverId: string;
  live: string;
}

function markerItem(m: MockMarker): DayServerItem {
  const verb = m.action === 'restart' ? 'Server restart' : 'Server stop';
  return {
    key: `m-${m.serverId}-${m.day}-${m.atMin}`, atMin: m.atMin, title: markerTooltip(m),
    short: `${verb} · ${formatClock(m.atMin)}`, serverId: m.serverId, live: serverLive(m.serverId),
  };
}

function windowItem(w: MockWindow): DayServerItem {
  return {
    key: `w-${w.serverId}-${w.day}-${w.startMin}`, atMin: w.startMin, title: windowTooltip(w),
    short: `Server up · ${formatClock(w.startMin)} – ${formatClock(w.endMin)}`,
    serverId: w.serverId, live: serverLive(w.serverId),
  };
}

export function serverItemsForDay(day: number): DayServerItem[] {
  const items = [...markersForDay(day).map(markerItem), ...WINDOWS.filter((w) => w.day === day).map(windowItem)];
  return items.sort((a, b) => a.atMin - b.atMin);
}
