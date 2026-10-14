/**
 * ROK-1774 — Pelican game-server schedules on the calendar. DEMO_MODE-gated,
 * dev-only wireframe for the operator to rule on before implementation.
 *
 * Implements the APPROVED direction (Pelican plan §3.7) — it does not propose
 * alternatives: neutral hatched `window` bands behind events on Week/Day, a
 * solid 2px `marker` tick with a power glyph, one muted glyph per day on Month,
 * muted one-line rows in the phone Schedule list, and a "Server schedules"
 * checkbox (default ON) in the funnel filter panel. All data is mocked
 * (`server-schedule-mock.ts`) — no API, no hooks beyond the DEMO_MODE gate.
 *
 * Gated identically to `SchedulingWireframesPage`: `useSystemStatus().demoMode`,
 * redirect to `/` when false, lazily imported from `lazy-routes.ts`.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useSystemStatus } from '../../hooks/use-system-status';
import { SchemeSwitcher, SideBySideToggle } from '../design-system/scheme-controls';
import { useForcedDarkRoot } from '../design-system/scheme-hooks';
import { DualFamily } from '../design-system/dual-family';
import { DAY_PANEL_INDEX } from './server-schedule-mock';
import { TimeGridPanel } from './TimeGridPanel';
import { MonthPanel } from './MonthPanel';
import { ScheduleListPanel } from './ScheduleListPanel';
import { FilterPanelMock } from './FilterPanelMock';

/** DEMO_MODE gate — mirrors `SchedulingWireframesPage`. */
function useDemoMode(): { ready: boolean; allowed: boolean } {
  const { data, isLoading } = useSystemStatus();
  if (isLoading) return { ready: false, allowed: false };
  return { ready: true, allowed: data?.demoMode === true };
}

const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];

function Header(): JSX.Element {
  return (
    <header className="mb-5 border-b border-edge pb-3">
      <h1 className="text-xl font-semibold text-foreground">ROK-1774 — Server schedules on the calendar</h1>
      <p className="mt-1 text-sm text-secondary">
        Approved direction (Pelican plan §3.7). Mock week 12–18 Oct: <b>Valheim Dedicated</b> restarts nightly at
        4:00 AM; <b>Minecraft — Survival</b> is up 6:00 PM – 2:00 AM on Wed, Fri and Sat (crossing midnight) and has
        an unmatched stop on Sun 11:00 PM. Three events overlap those windows so the layering is visible. Hover,
        focus or long-press a power glyph for its tooltip. Mocked data only — nothing here talks to the API.
      </p>
    </header>
  );
}

/** One titled frame with a one-line note on what to look at. */
function Frame({ title, note, children }: { title: string; note: string; children: ReactNode }): JSX.Element {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      <p className="text-xs text-muted">{note}</p>
      {children}
    </section>
  );
}

function Frames({ showServers, onToggleServers }: {
  showServers: boolean;
  onToggleServers: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="space-y-8">
      <Frame title="Filters" note="Funnel panel (§4.1) — a Layers group with one checkbox, default ON. Drives every frame below.">
        <FilterPanelMock showServers={showServers} onChange={onToggleServers} />
      </Frame>
      <Frame title="Week (desktop)" note="Hatched bands sit BEHIND events; solid restart ticks sit above. Only the glyph takes the pointer.">
        <TimeGridPanel days={WEEK_DAYS} showServers={showServers} testId="ss-panel-week" minWidth={760} />
      </Frame>
      <Frame title="Day" note="Sat 17 — the 12–2 AM tail of Friday's window, the 4 AM restart, and the 6 PM window under the Bonemass attempt.">
        <TimeGridPanel days={[DAY_PANEL_INDEX]} showServers={showServers} testId="ss-panel-day" minWidth={320} />
      </Frame>
      <Frame title="Month" note="No bands. One muted glyph per day with a marker or window; its tooltip lists them.">
        <MonthPanel showServers={showServers} />
      </Frame>
      <Frame title="Schedule (phone, 390px)" note="Muted one-line rows, interleaved by time, quieter than event cards.">
        <ScheduleListPanel showServers={showServers} />
      </Frame>
    </div>
  );
}

function Controls({ sideBySide, onToggle }: { sideBySide: boolean; onToggle: () => void }): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <SchemeSwitcher />
      <SideBySideToggle active={sideBySide} onToggle={onToggle} />
    </div>
  );
}

/** DEMO_MODE-gated wireframe page — see file-level docstring. */
export function ServerScheduleWireframesPage(): JSX.Element | null {
  const { ready, allowed } = useDemoMode();
  const [showServers, setShowServers] = useState(true);
  const [sideBySide, setSideBySide] = useState(false);
  useForcedDarkRoot(sideBySide);
  if (!ready) return null;
  if (!allowed) return <Navigate to="/" replace />;
  const frames = <Frames showServers={showServers} onToggleServers={setShowServers} />;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Header />
      <Controls sideBySide={sideBySide} onToggle={() => setSideBySide((v) => !v)} />
      {sideBySide ? <DualFamily>{frames}</DualFamily> : frames}
    </div>
  );
}
