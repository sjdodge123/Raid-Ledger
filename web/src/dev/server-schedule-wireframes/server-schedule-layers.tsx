/**
 * ROK-1774 — the two server-schedule marks (Pelican plan §3.7, approved).
 *
 * - `WindowBand`: server up from a start to a stop. A NEUTRAL diagonal hatch
 *   (`--color-edge-strong` at 25% over transparent) with a 1px `border-edge`
 *   left edge, drawn BEHIND events. Never `busy` (violet), `slot` (cyan), the
 *   heat ramp or a game colour — those already mean something on a calendar.
 * - `MarkerTick`: a restart, or a stop with no matching start. A 2px SOLID
 *   `border-edge-strong` tick across the column (solid so it cannot be read as
 *   the dashed `SLOT_MARK`) with a small power glyph.
 *
 * Both are `pointer-events-none`; only the glyph takes the pointer, so a click
 * on an event under a band still reaches the event.
 */
import type { CSSProperties, JSX } from 'react';
import { PowerIcon } from '@heroicons/react/16/solid';
import {
  markerTooltip, serverLive, serverName, windowTooltip,
  type MockMarker, type WindowSegment,
} from './server-schedule-mock';

/** Hand-built to match `bg-edge-strong/25` — same `in oklab` spelling (design-system §2.1). */
const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-edge-strong) 25%, transparent) 0 6px, transparent 6px 12px)',
};

/** Vertical placement as a % of a 24h column. */
function spanStyle(startMin: number, endMin: number): CSSProperties {
  return { top: `${(startMin / 1440) * 100}%`, height: `${((endMin - startMin) / 1440) * 100}%` };
}

/** One tooltip entry: what happens, then the server's live state. */
export interface GlyphItem {
  title: string;
  live: string;
}

/** Tooltip body — one title + live-state pair per item. */
function GlyphTip({ items }: { items: GlyphItem[] }): JSX.Element {
  return (
    <span
      role="tooltip"
      className="invisible absolute left-5 top-1/2 z-30 w-max max-w-[16rem] -translate-y-1/2 space-y-1 rounded-md border border-edge-strong bg-surface px-2 py-1 text-xs opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      {items.map((it) => (
        <span key={it.title} className="block">
          <span className="block text-foreground">{it.title}</span>
          <span className="block text-muted">{it.live}</span>
        </span>
      ))}
    </span>
  );
}

/** Hover / focus / long-press glyph — the ONLY server element that takes the pointer. */
export function ServerGlyph({ items, testId }: { items: GlyphItem[]; testId: string }): JSX.Element {
  return (
    <span className="group relative pointer-events-auto inline-flex">
      <button
        type="button"
        data-testid={testId}
        aria-label={items.map((it) => `${it.title}. ${it.live}`).join(' ')}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-edge-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-success"
      >
        <PowerIcon aria-hidden="true" className="h-3 w-3" />
      </button>
      <GlyphTip items={items} />
    </span>
  );
}

/** A window piece inside one day column — behind the event layer. */
export function WindowBand({ segment }: { segment: WindowSegment }): JSX.Element {
  const label = `Server up · ${serverName(segment.serverId)}`;
  return (
    <div
      data-testid="ss-window-band"
      aria-label={windowTooltip(segment)}
      className="pointer-events-none absolute inset-x-0 z-0 border-l border-edge"
      style={{ ...spanStyle(segment.startMin, segment.endMin), ...HATCH_STYLE }}
    >
      <span className="block truncate px-1 pt-0.5 text-[11px] leading-tight text-dim">
        {segment.continued ? `${label} (cont.)` : label}
      </span>
    </div>
  );
}

/** A restart / orphan-stop tick across the column, above events. */
export function MarkerTick({ marker }: { marker: MockMarker }): JSX.Element {
  return (
    <div
      data-testid="ss-marker-tick"
      className="pointer-events-none absolute inset-x-0 z-20 h-0"
      style={{ top: `${(marker.atMin / 1440) * 100}%` }}
    >
      <div className="absolute inset-x-0 top-0 border-t-2 border-solid border-edge-strong" />
      <span className="absolute left-0.5 top-px -translate-y-1/2">
        <ServerGlyph items={[{ title: markerTooltip(marker), live: serverLive(marker.serverId) }]} testId="ss-marker-glyph" />
      </span>
    </div>
  );
}
