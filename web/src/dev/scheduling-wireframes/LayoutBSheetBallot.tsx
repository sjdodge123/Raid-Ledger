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
 * Operator ruling 2026-09-14: the sheet is TWO steps, not one grid — a simple
 * game-time check (`SheetStepOne`) and then the ballot. The old inline
 * staleness strip is gone.
 *
 * The sheet is drawn inline (not through the real overlay primitives) so the
 * desktop and 375px treatments can sit side by side on one page; the labelled
 * frame says which primitive the real surface uses.
 */
import { useState, type JSX } from 'react';
import { Treatments, Rationale } from './wireframe-chrome';
import { Stepper, StepOne } from './SheetStepOne';
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

/**
 * Discrete fill steps — Tailwind needs static class names, and every step here
 * has a `[data-scheme="light"]` remap in `web/src/index.css` so the panel is
 * legible in both colour families.
 */
const FILL = [
  '',
  'bg-emerald-500/10',
  'bg-emerald-500/20',
  'bg-emerald-600/30',
  'bg-emerald-600/30 ring-1 ring-inset ring-emerald-500/30',
];

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
function cellStat(p: WfPoll, dayIdx: number, hour: number, viewerFresh: boolean): BallotCell {
  const day = DAYS[dayIdx];
  if (p.overlap.length === 0) {
    return { fresh: 0, stale: 0, unknown: p.members, slot: slotAt(p, day, hour) };
  }
  const seed = (dayIdx * 7 + hour * 3) % 11;
  const peak = hour >= 19 && hour <= 21 ? 2 : 0;
  let fresh = Math.max(0, Math.min(3, (seed % 3) + peak - 1));
  let stale = Math.min(p.members - fresh, ((seed + dayIdx) % 4) + 2);
  // Step 1's "Looks right" moves the viewer from the hatched pile into the fill.
  if (viewerFresh && stale > 0) {
    fresh += 1;
    stale -= 1;
  }
  return { fresh, stale, unknown: p.members - fresh - stale, slot: slotAt(p, day, hour) };
}

/** One tappable cell: fill = fresh, hatch = stale/unknown, badge = votes. */
function Cell({ c, label, active, inert, onPick }: {
  c: BallotCell; label: string; active: boolean; inert: boolean; onPick: () => void;
}): JSX.Element {
  const mine = c.slot?.mine ?? false;
  const border = c.slot ? 'border-emerald-500/30' : 'border-edge';
  return (
    <button
      type="button"
      disabled={inert}
      aria-pressed={c.slot ? mine : undefined}
      aria-label={`${label} — ${c.fresh} free, ${c.stale + c.unknown} unknown${c.slot ? `, ${c.slot.votes} votes` : ', no time proposed yet'}`}
      onClick={onPick}
      className={`relative min-h-[44px] rounded border text-[10px] font-medium transition-colors disabled:opacity-40 ${border} ${FILL[Math.min(c.fresh, 4)]} ${
        active ? 'ring-2 ring-inset ring-emerald-500/30' : ''
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
        <span className="h-3 w-4 rounded border border-edge bg-emerald-600/30" /> free now
      </span>
      <span className="flex items-center gap-1">
        <span className="relative h-3 w-4 rounded border border-edge text-muted opacity-40" style={HATCH} /> stale or unknown
      </span>
      <span className="flex items-center gap-1">
        <span className="flex h-3 w-4 items-center justify-center rounded border border-emerald-500/30 text-[8px] text-foreground">2</span> votes
      </span>
    </div>
  );
}

/**
 * The viewer's own line in step 2 — hatched while they are counted as unknown,
 * solid once step 1's "Looks right" stamped the confirmation. This is what
 * replaced the rejected inline strip: the consequence of skipping, shown in the
 * same two channels the grid uses.
 */
function ViewerRow({ confirmed, ageDays }: { confirmed: boolean; ageDays: number | null }): JSX.Element {
  return (
    <div
      data-testid="wf-bs-viewer-row"
      data-hatched={confirmed ? 'false' : 'true'}
      className="flex items-center gap-2 rounded border border-edge px-2 py-1 text-[10px]"
    >
      <span
        aria-hidden="true"
        className={`relative h-3 w-4 shrink-0 rounded border border-edge ${confirmed ? 'bg-emerald-600/30' : 'text-muted opacity-40'}`}
        style={confirmed ? undefined : HATCH}
      />
      <span className={confirmed ? 'text-foreground' : 'text-amber-300'}>
        {confirmed
          ? 'You — confirmed just now, so your week counts as free in this grid'
          : `You — still counted as unknown${ageDays === null ? '' : ` (${ageDays} days old)`}, hatched below`}
      </span>
    </div>
  );
}

/** Readout under the grid: what the selected cell means and what a tap does. */
function Readout({ p, sel, fresh }: {
  p: WfPoll; sel: { d: number; h: number } | null; fresh: boolean;
}): JSX.Element {
  if (!sel) {
    return (
      <p data-testid="wf-bs-readout" className="text-[11px] text-secondary">
        Tap any cell — an empty one proposes that time and votes for it in one call; a lit one is a vote.
      </p>
    );
  }
  const c = cellStat(p, sel.d, sel.h, fresh);
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
function BallotGrid({ p, sel, fresh, onPick }: {
  p: WfPoll; sel: { d: number; h: number } | null; fresh: boolean;
  onPick: (d: number, h: number) => void;
}): JSX.Element {
  const inert = !p.canVote || p.status !== 'open';
  return (
    <div data-testid="wf-bs-grid" className="overflow-x-auto">
      <div className="grid min-w-[320px] gap-1" style={{ gridTemplateColumns: `2.2rem repeat(7, minmax(36px,1fr))` }}>
        <span />
        {DAYS.map((d) => <span key={d} className="text-center text-[10px] text-muted">{d}</span>)}
        {HOURS.map((h) => (
          <GridRow key={h} p={p} hour={h} sel={sel} fresh={fresh} inert={inert} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

/** One hour row. */
function GridRow({ p, hour, sel, fresh, inert, onPick }: {
  p: WfPoll; hour: number; sel: { d: number; h: number } | null; fresh: boolean; inert: boolean;
  onPick: (d: number, h: number) => void;
}): JSX.Element {
  const hr12 = hour > 12 ? hour - 12 : hour;
  return (
    <>
      <span className="self-center text-[10px] text-muted">{hr12}p</span>
      {DAYS.map((d, i) => {
        const c = cellStat(p, i, hour, fresh);
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

/** Viewer's template is outside the 7-day freshness window (or never set). */
function isStale(p: WfPoll): boolean {
  const age = p.viewerGameTimeAgeDays;
  return age === null || age > 7;
}

/**
 * Labelled stand-in for the real overlay primitive, and the owner of the
 * two-step state: a stale viewer opens on step 1, a fresh one straight on the
 * ballot with segment 1 still tappable.
 */
function SheetFrame({ surface, p }: { surface: string; p: WfPoll }): JSX.Element {
  const stale = isStale(p);
  const [step, setStep] = useState<1 | 2>(stale ? 1 : 2);
  const [confirmed, setConfirmed] = useState(!stale);
  return (
    <div className="mt-3 rounded-lg border border-edge bg-surface">
      <Stepper step={step} onStep={setStep} />
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-sm font-semibold text-foreground">Find a better time</span>
        <span className="text-[10px] uppercase tracking-wider text-muted">{surface} ✕</span>
      </div>
      <div className="space-y-2 p-3">
        {step === 1 ? (
          <StepOne
            ageDays={p.viewerGameTimeAgeDays}
            onConfirm={() => {
              setConfirmed(true);
              setStep(2);
            }}
            onSkip={() => setStep(2)}
          />
        ) : (
          <Body p={p} confirmed={confirmed} />
        )}
      </div>
    </div>
  );
}

/** Step 2 — the ballot itself, shared by both treatments. */
function Body({ p, confirmed }: { p: WfPoll; confirmed: boolean }): JSX.Element {
  const [sel, setSel] = useState<{ d: number; h: number } | null>(null);
  return (
    <>
      <Legend />
      <ViewerRow confirmed={confirmed} ageDays={p.viewerGameTimeAgeDays} />
      <BallotGrid p={p} sel={sel} fresh={confirmed} onPick={(d, h) => setSel({ d, h })} />
      <Readout p={p} sel={sel} fresh={confirmed} />
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
          <SheetFrame surface="Modal · ≥768px" p={p} />
        </div>
      }
      mobile={
        <div data-testid="wf-bs-mobile">
          <p className="text-xs text-secondary">Below 768px the same body is a `BottomSheet`.</p>
          <SheetFrame surface="Bottom sheet · 375px" p={p} />
        </div>
      }
    />
  );
}

/** Candidate B · sheet's in-page rationale. */
export function LayoutBSheetRationale(): JSX.Element {
  return (
    <Rationale
      pitch="Layout B stays the page and replaces the body only; this panel is what opens behind its “Find a better time” affordance. Layout A's grid, moved inside the sheet and made the ballot: one tap on a cell proposes the time and casts the vote in a single call, so the datetime-local form disappears. Two steps (operator ruling 2026-09-14): a simple game-time check first, the ballot second; the week editor never renders in an overlay."
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
