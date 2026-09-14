/**
 * Candidate B · sheet — "the grid IS the ballot" (ROK-1555) — DEV-ONLY wireframe.
 *
 * Layout A's interior, relocated into the sheet Layout B already ships
 * (`SchedulingBetterTimeSheet`: `Modal` ≥768px, `BottomSheet` below). One tap
 * on a cell proposes AND votes — the `datetime-local` suggest form is gone.
 * The model it renders is the one argued in
 * `docs/spikes/rok-1540-scheduling-poll-audit.md` §"Find a better time":
 * fill = FRESH availability, hatch = stale/unknown, badge = votes.
 *
 * The sheet is drawn inline (not through the real overlay primitives) so the
 * desktop and 375px treatments can sit side by side on one page; the labelled
 * frame says which primitive the real surface uses.
 */
import { useState, type JSX } from 'react';
import { Treatments, Rationale } from './wireframe-chrome';
import { pollFor, type WfPoll, type WfSlot, type WfStateId } from './wireframe-states';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Evening band — where every prod template actually clusters (§e). */
const HOURS = [17, 18, 19, 20, 21, 22, 23];

/** What one grid cell knows under the proposed model. */
interface BallotCell {
  fresh: number;
  stale: number;
  unknown: number;
  slot: WfSlot | null;
}

/** Discrete fill steps — Tailwind needs static class names. */
const FILL = ['', 'bg-emerald-500/10', 'bg-emerald-500/20', 'bg-emerald-500/35', 'bg-emerald-500/50'];

/** Diagonal hatch standing in for "stale / unknown", drawn in the token colour. */
const HATCH = {
  backgroundImage:
    'repeating-linear-gradient(45deg, transparent 0 3px, currentColor 3px 4px)',
};

/** The slot proposed in this cell, if any. Mocks map Thu/Fri/Sat 8/9/7pm. */
function slotAt(p: WfPoll, day: string, hour: number): WfSlot | null {
  const hr12 = hour > 12 ? hour - 12 : hour;
  return p.slots.find((s) => s.day === day && s.time.startsWith(`${hr12}:`)) ?? null;
}

/**
 * Deterministic mock availability for one cell. Pure — same input, same cell,
 * every render. Fresh members are deliberately scarce: prod has 3 of 9.
 */
function cellStat(p: WfPoll, dayIdx: number, hour: number): BallotCell {
  const day = DAYS[dayIdx];
  if (p.overlap.length === 0) {
    return { fresh: 0, stale: 0, unknown: p.members, slot: slotAt(p, day, hour) };
  }
  const seed = (dayIdx * 7 + hour * 3) % 11;
  const peak = hour >= 19 && hour <= 21 ? 2 : 0;
  const fresh = Math.max(0, Math.min(3, (seed % 3) + peak - 1));
  const stale = Math.min(p.members - fresh, ((seed + dayIdx) % 4) + 2);
  return { fresh, stale, unknown: p.members - fresh - stale, slot: slotAt(p, day, hour) };
}

/** One tappable cell: fill = fresh, hatch = stale/unknown, badge = votes. */
function Cell({ c, label, active, inert, onPick }: {
  c: BallotCell; label: string; active: boolean; inert: boolean; onPick: () => void;
}): JSX.Element {
  const mine = c.slot?.mine ?? false;
  const border = c.slot ? (mine ? 'border-emerald-400' : 'border-emerald-500/50') : 'border-edge';
  return (
    <button
      type="button"
      disabled={inert}
      aria-pressed={c.slot ? mine : undefined}
      aria-label={`${label} — ${c.fresh} free, ${c.stale + c.unknown} unknown${c.slot ? `, ${c.slot.votes} votes` : ', no time proposed yet'}`}
      onClick={onPick}
      className={`relative min-h-[44px] rounded border text-[10px] font-medium transition-colors disabled:opacity-40 ${border} ${FILL[Math.min(c.fresh, 4)]} ${
        active ? 'ring-2 ring-emerald-400' : ''
      } ${inert ? '' : 'hover:border-emerald-500/60'}`}
    >
      {c.stale + c.unknown > 0 && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded text-muted opacity-30" style={HATCH} />
      )}
      {c.slot && (
        <span className="relative text-foreground">
          {c.slot.votes}
          {mine && <span className="text-emerald-300">✓</span>}
        </span>
      )}
    </button>
  );
}

/** Legend for the two shading channels — without it the hatch is noise. */
function Legend(): JSX.Element {
  return (
    <div data-testid="wf-bs-legend" className="flex flex-wrap items-center gap-3 text-[10px] text-muted">
      <span className="flex items-center gap-1">
        <span className="h-3 w-4 rounded border border-edge bg-emerald-500/35" /> free now
      </span>
      <span className="flex items-center gap-1">
        <span className="relative h-3 w-4 rounded border border-edge text-muted opacity-40" style={HATCH} /> stale or unknown
      </span>
      <span className="flex items-center gap-1">
        <span className="flex h-3 w-4 items-center justify-center rounded border border-emerald-500/50 text-[8px] text-foreground">2</span> votes
      </span>
    </div>
  );
}

/** Inline refresh strip — the §d recommendation, next to the data it explains. */
function StaleStrip({ p }: { p: WfPoll }): JSX.Element | null {
  const age = p.viewerGameTimeAgeDays;
  if (age !== null && age <= 7) return null;
  return (
    <div data-testid="wf-bs-stale" className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
      <p className="text-[11px] text-amber-200">
        {age === null
          ? "You haven't set your Game Time — you're one of the unknowns in this grid."
          : `Your availability is ${age} days old — most of this grid is guesswork.`}
        <span className="ml-1.5 underline">Refresh →</span>
      </p>
      <p className="mt-0.5 text-[10px] text-muted">
        Opens the same GameTimeRefreshModal the page already auto-opens (ROK-1301) — the strip only
        earns the tap here, where the cost of stale data is visible.
      </p>
    </div>
  );
}

/** Readout under the grid: what the selected cell means and what a tap does. */
function Readout({ p, sel }: { p: WfPoll; sel: { d: number; h: number } | null }): JSX.Element {
  if (!sel) {
    return (
      <p data-testid="wf-bs-readout" className="text-[11px] text-secondary">
        Tap any cell — an empty one proposes that time and votes for it in one call; a lit one is a vote.
      </p>
    );
  }
  const c = cellStat(p, sel.d, sel.h);
  const hr12 = sel.h > 12 ? sel.h - 12 : sel.h;
  const action = !p.canVote || p.status !== 'open'
    ? 'This poll is closed — the grid is read-only.'
    : c.slot
      ? c.slot.mine ? 'Tapping again withdraws your vote; the time stays on the ladder.' : 'Tapping votes for this time (approval — you can mark several).'
      : 'Tapping proposes this time AND casts your vote — one call, no form.';
  return (
    <p data-testid="wf-bs-readout" className="text-[11px] text-secondary">
      <span className="text-foreground">{DAYS[sel.d]} {hr12}:00 PM</span>
      {' · '}{c.fresh} free · {c.stale + c.unknown} unknown
      {c.slot ? ` · ${c.slot.votes} votes` : ' · not proposed'}
      <span className="mt-0.5 block text-muted">{action}</span>
    </p>
  );
}

/** The grid itself; scrolls horizontally on 375px rather than dropping days. */
function BallotGrid({ p, sel, onPick }: {
  p: WfPoll; sel: { d: number; h: number } | null; onPick: (d: number, h: number) => void;
}): JSX.Element {
  const inert = !p.canVote || p.status !== 'open';
  return (
    <div data-testid="wf-bs-grid" className="overflow-x-auto">
      <div className="grid min-w-[320px] gap-1" style={{ gridTemplateColumns: `2.2rem repeat(7, minmax(36px,1fr))` }}>
        <span />
        {DAYS.map((d) => <span key={d} className="text-center text-[10px] text-muted">{d}</span>)}
        {HOURS.map((h) => (
          <GridRow key={h} p={p} hour={h} sel={sel} inert={inert} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

/** One hour row. */
function GridRow({ p, hour, sel, inert, onPick }: {
  p: WfPoll; hour: number; sel: { d: number; h: number } | null; inert: boolean;
  onPick: (d: number, h: number) => void;
}): JSX.Element {
  const hr12 = hour > 12 ? hour - 12 : hour;
  return (
    <>
      <span className="self-center text-[10px] text-muted">{hr12}p</span>
      {DAYS.map((d, i) => {
        const c = cellStat(p, i, hour);
        return (
          <Cell
            key={d}
            c={c}
            label={`${d} ${hr12}:00 PM`}
            active={sel?.d === i && sel?.h === hour}
            inert={inert || (c.slot?.past ?? false)}
            onPick={() => onPick(i, hour)}
          />
        );
      })}
    </>
  );
}

/** Labelled stand-in for the real overlay primitive. */
function SheetFrame({ surface, children }: { surface: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="mt-3 rounded-lg border border-edge bg-surface">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-sm font-semibold text-foreground">Find a better time</span>
        <span className="text-[10px] uppercase tracking-wider text-muted">{surface} ✕</span>
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </div>
  );
}

/** The sheet body, shared by both treatments. */
function Body({ p }: { p: WfPoll }): JSX.Element {
  const [sel, setSel] = useState<{ d: number; h: number } | null>(null);
  return (
    <>
      <StaleStrip p={p} />
      <Legend />
      <BallotGrid p={p} sel={sel} onPick={(d, h) => setSel({ d, h })} />
      <Readout p={p} sel={sel} />
      <p className="text-[10px] text-muted">
        Weekly template, evening band only. Shading counts members confirmed in the last 7 days;
        everyone else is hatched, never counted as free.
      </p>
    </>
  );
}

/** Candidate B · sheet rendered for one state, desktop + mobile. */
export function LayoutBSheetBallot({ state }: { state: WfStateId }): JSX.Element {
  const p = pollFor(state);
  return (
    <Treatments
      desktop={
        <div data-testid="wf-bs-desktop">
          <p className="text-xs text-secondary">
            Ladder unchanged below; “+ None of these work” opens this. Desktop = `Modal`.
          </p>
          <SheetFrame surface="Modal · ≥768px"><Body p={p} /></SheetFrame>
        </div>
      }
      mobile={
        <div data-testid="wf-bs-mobile">
          <p className="text-xs text-secondary">Below 768px the same body is a `BottomSheet`.</p>
          <SheetFrame surface="Bottom sheet · 375px"><Body p={p} /></SheetFrame>
        </div>
      }
    />
  );
}

/** Candidate B · sheet's in-page rationale. */
export function LayoutBSheetRationale(): JSX.Element {
  return (
    <Rationale
      pitch="Layout B stays the page and replaces the body only; this panel is what opens behind its “Find a better time” affordance. Layout A's grid, moved inside the sheet and made the ballot: one tap on a cell proposes the time and casts the vote in a single call, so the datetime-local form disappears."
      wins={[
        'Proposing collapses from cell-click → prefill → Suggest into one tap (F-06, P-2)',
        'Fill is FRESH availability and stale templates are hatched — on prod 6 of 9 templated members are stale, so today\'s single count reports guesswork as fact',
        'The staleness prompt lands where its cost is visible: an inline strip opening the shipped GameTimeRefreshModal, not a second painter inside a sheet',
        'Reuses the shipped sheet (Modal ≥768px / BottomSheet below) and GameTimeGrid — one breakpoint, closing F-14 on this surface',
      ]}
      costs={[
        'Needs a new availability response and a cell-vote endpoint (§g) — the only part of the epic that is not web-only',
        'A grid still cannot carry voter identity, so the page\'s ladder remains the answer surface (open question Q-2)',
        'Seven columns at 375px means a horizontal scroll inside an overlay — the one gesture the sheet did not already own',
        'Fresh/stale/unknown is three numbers where there was one; the legend is now load-bearing',
      ]}
    />
  );
}
