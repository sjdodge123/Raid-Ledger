/**
 * Candidate A — "Calendar-first heatmap" (ROK-1540) — DEV-ONLY wireframe.
 *
 * The week grid IS the ballot: a cell is a vote, and the proposed times are
 * columns already lit by group availability. An answer strip pinned above the
 * grid carries the leader so P-1 is satisfied before the grid is read.
 */
import type { JSX } from 'react';
import { Treatments, Faces, StatusPill, Rationale, VoteBar } from './wireframe-chrome';
import { pollFor, statusLine, leader, isTied, type WfPoll, type WfStateId } from './wireframe-states';

/** Pinned answer strip — the one-glance answer (P-1). */
function AnswerStrip({ p, compact }: { p: WfPoll; compact?: boolean }): JSX.Element {
  const top = leader(p);
  const tone = p.status === 'locked' ? 'locked' : p.status === 'open' ? 'open' : 'closed';
  return (
    <div data-testid="wf-a-answer" className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusPill text={statusLine(p)} tone={tone} />
        <span className="text-[11px] text-muted">{p.deadline ?? 'no deadline'}</span>
      </div>
      {p.status === 'locked' ? (
        <p className="mt-1.5 text-base font-semibold text-foreground">
          {p.game} — {p.lockedTime}
          <span className="ml-2 text-xs font-normal text-cyan-300 underline">open the event →</span>
        </p>
      ) : p.status === 'cancelled' ? (
        <p className="mt-1.5 text-sm text-rose-300">Cancelled — “{p.reason}”</p>
      ) : top ? (
        <p className="mt-1.5 text-base font-semibold text-foreground">
          Leading: {top.day} {top.time}
          <span className="ml-2 text-xs font-normal text-secondary">{top.votes} of {p.members}{isTied(p) ? ' · tied, earliest wins' : ''}</span>
        </p>
      ) : (
        <p className="mt-1.5 text-sm text-secondary">No times proposed yet — tap any cell below to propose one.</p>
      )}
      {!compact && p.lateJoiner && (
        <p className="mt-1 text-xs text-amber-300">You joined late — {p.voters} of {p.members} have already voted.</p>
      )}
    </div>
  );
}

const HOURS = ['6', '7', '8', '9', '10'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** One grid cell; proposed slots render as candidate columns. */
function Cell({ p, day, hour }: { p: WfPoll; day: string; hour: string }): JSX.Element {
  const slot = p.slots.find((s) => s.day === day && s.time.startsWith(hour));
  const idx = slot ? p.slots.indexOf(slot) : -1;
  const heat = idx >= 0 ? (p.overlap[idx] ?? 0) : 0;
  const interactive = p.canVote && p.status === 'open';
  const label = slot
    ? `${slot.mine ? 'Remove vote for' : 'Vote for'} ${day} ${slot.time} — ${slot.votes} votes`
    : `Propose ${day} ${hour}:00 PM`;
  return (
    <button
      type="button"
      disabled={!interactive || slot?.past}
      aria-label={label}
      aria-pressed={slot ? slot.mine : undefined}
      className={`min-h-[44px] rounded border text-[10px] transition-colors disabled:opacity-50 ${
        slot
          ? slot.mine
            ? 'border-emerald-400 bg-emerald-600 text-white'
            : 'border-emerald-500/40 text-emerald-200'
          : 'border-edge text-muted hover:border-emerald-500/50'
      }`}
      style={slot && !slot.mine ? { backgroundColor: `rgba(16,185,129,${0.12 + heat * 0.35})` } : undefined}
    >
      {slot ? `${slot.votes}${slot.mine ? ' ✓' : ''}` : ''}
    </button>
  );
}

/** The week grid, doubling as the ballot. */
function Grid({ p, days }: { p: WfPoll; days: string[] }): JSX.Element {
  return (
    <div data-testid="wf-a-grid" className="mt-3 rounded-lg border border-edge bg-surface p-2">
      <div className="grid gap-1" style={{ gridTemplateColumns: `2rem repeat(${days.length}, minmax(0,1fr))` }}>
        <span />
        {days.map((d) => <span key={d} className="text-center text-[10px] text-muted">{d}</span>)}
        {HOURS.map((h) => (
          <Row key={h} p={p} hour={h} days={days} />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">
        Shade = group availability · number = votes · tap a lit cell to vote, an empty one to propose.
      </p>
    </div>
  );
}

/** One hour row of the grid. */
function Row({ p, hour, days }: { p: WfPoll; hour: string; days: string[] }): JSX.Element {
  return (
    <>
      <span className="self-center text-[10px] text-muted">{hour}p</span>
      {days.map((d) => <Cell key={d} p={p} day={d} hour={hour} />)}
    </>
  );
}

/** Ranked recap under the grid — the grid alone cannot carry voter identity. */
function Recap({ p }: { p: WfPoll }): JSX.Element | null {
  if (p.slots.length === 0) return null;
  return (
    <ul data-testid="wf-a-recap" className="mt-3 space-y-1.5">
      {[...p.slots].sort((a, b) => b.votes - a.votes || a.id - b.id).map((s) => (
        <li key={s.id} className="rounded border border-edge bg-panel/50 p-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-foreground">{s.day} {s.time}{s.past && <span className="ml-1 text-muted">· past</span>}</span>
            <span className="flex items-center gap-2 text-muted"><Faces names={s.voters} />{s.votes}</span>
          </div>
          <div className="mt-1"><VoteBar votes={s.votes} members={p.members} /></div>
          {s.conflict && <p className="mt-1 text-[10px] text-amber-300">⚠ Clashes with your “{s.conflict}”</p>}
        </li>
      ))}
    </ul>
  );
}

/** Candidate A rendered for one state, desktop + mobile. */
export function LayoutAHeatmap({ state }: { state: WfStateId }): JSX.Element {
  const p = pollFor(state);
  return (
    <Treatments
      desktop={
        <div data-testid="wf-a-desktop">
          <AnswerStrip p={p} />
          <Grid p={p} days={DAYS} />
          <Recap p={p} />
        </div>
      }
      mobile={
        <div data-testid="wf-a-mobile">
          <AnswerStrip p={p} compact />
          <Grid p={p} days={DAYS.slice(3)} />
          <Recap p={p} />
          <p className="mt-2 text-[10px] text-muted">Mobile shows the 4 days nearest the deadline; swipe for the rest.</p>
        </div>
      }
    />
  );
}

/** Candidate A's in-page rationale. */
export function LayoutARationale(): JSX.Element {
  return (
    <Rationale
      pitch="The week grid is the ballot. Proposing and voting are the same gesture, and the group's availability is visible at the moment of choosing rather than in a separate panel."
      wins={[
        'One tap votes AND one tap proposes — the suggest form disappears entirely (F-06, P-2)',
        'Availability and votes occupy the same pixels; no scrolling between analysis and answer',
        'Reuses the shipped GameTimeGrid, so heatmap, preview blocks and week nav come for free',
        'Conflicts can paint directly on the cell rather than hiding in a title= tooltip (F-09)',
      ]}
      costs={[
        'A grid cannot carry voter identity — the ranked recap has to exist anyway, so the page has two representations of one list',
        'Weakest on 375px: seven columns do not fit, so mobile shows a 4-day window and the leader can fall outside it',
        'Hardest state to render is the boring one — a poll with three scattered slots is 95% empty grid',
        'Screen-reader story is the worst of the three: a 35-cell button matrix versus a list',
      ]}
    />
  );
}
