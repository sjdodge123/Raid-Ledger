/**
 * Shared presentational chrome for the ROK-1540 scheduling wireframes —
 * DEV-ONLY. Device frames, the state switcher, rationale blocks and the
 * small vote/avatar bits every candidate layout reuses.
 *
 * Styling uses `web/src/index.css` tokens (surface / panel / overlay / edge /
 * foreground / secondary / muted) and the `NAV_CHIP_CLASS` primitive — no new
 * design primitives are introduced here (principle P-4).
 */
import type { JSX, ReactNode } from 'react';
import { NAV_CHIP_CLASS } from '../../components/ui/nav-chip';
import { WF_STATES, type WfStateId } from './wireframe-states';

/** Desktop viewport frame. */
export function Desk({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div data-testid="wf-desktop" className="rounded-lg border border-edge bg-panel/40 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted">Desktop</div>
      {children}
    </div>
  );
}

/** 375px phone frame — the width every hit target is judged at. */
export function Phone({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div data-testid="wf-mobile" className="rounded-lg border border-edge bg-panel/40 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wider text-muted">Mobile · 375px</div>
      <div className="mx-auto w-[375px] max-w-full rounded-xl border border-edge bg-backdrop p-2">
        {children}
      </div>
    </div>
  );
}

/** The three header actions the shipped page already offers the organiser. */
const SHIPPED_ACTIONS = ['ADD PARTICIPANTS', 'REMIND VOTERS', 'CANCEL POLL'];

/**
 * The poll header as it ships TODAY, mocked and clearly labelled.
 *
 * Operator ruling 2026-09-13: the JourneyHero block stays exactly as it is —
 * the scheduling-poll badge, the Participants avatar button, the three
 * organiser actions, the task line and its sub-line, and the game-ref row
 * with "Lock this time →". The redesign replaces what sits BELOW this strip
 * and nothing above it, so every candidate renders it: without the strip,
 * Layout B's own status header reads as a proposed REPLACEMENT for the
 * JourneyHero rather than as the body beneath it.
 */
export function ShippedHeaderStrip(): JSX.Element {
  return (
    <div
      data-testid="wf-shipped-header"
      className="mb-3 rounded-lg border border-dashed border-edge bg-overlay/20 p-2 opacity-80"
    >
      <div className="text-[10px] uppercase tracking-wider text-muted">
        Shipped header — unchanged by this redesign (operator ruling 2026-09-13)
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-secondary">
        <span className="font-mono text-amber-300/80">🗓 SCHEDULING POLL · STARTED BY ROKNUA</span>
        <span className="inline-flex items-center gap-1 rounded border border-edge bg-surface px-1.5 py-0.5">
          Participants · 4 <Faces names={['Rok', 'Ash', 'Bex', 'Cy']} />
        </span>
        {SHIPPED_ACTIONS.map((a) => (
          <span key={a} className="rounded border border-edge bg-surface px-1.5 py-0.5 text-[10px] text-muted">{a}</span>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-foreground">Pick a time that works for everyone.</p>
      <p className="text-[11px] text-muted">9 people in this poll · 6 of 9 have voted on times so far</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-edge bg-surface/60 p-1.5 text-[11px] text-secondary">
        <span aria-hidden="true" className="h-6 w-5 rounded-sm bg-overlay" />
        <span className="text-foreground">Helldivers 2 ⓘ</span>
        <span className="text-muted">You + 3 members</span>
        <Faces names={['Rok', 'Ash', 'Bex', 'Cy']} />
        <span className="ml-auto rounded border border-edge px-1.5 py-0.5 text-[10px] text-muted">Lock this time →</span>
      </div>
    </div>
  );
}

/**
 * Side-by-side desktop + mobile treatment of one layout, each opening with
 * the shipped header strip so the candidate below is read as a replacement
 * for the BODY only.
 */
export function Treatments({ desktop, mobile }: { desktop: ReactNode; mobile: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Desk><ShippedHeaderStrip />{desktop}</Desk>
      <Phone><ShippedHeaderStrip />{mobile}</Phone>
    </div>
  );
}

/** State switcher — one chip per audited state. */
export function StatePicker({ value, onChange }: { value: WfStateId; onChange: (id: WfStateId) => void }): JSX.Element {
  return (
    <div role="group" aria-label="Poll state" data-testid="wf-state-picker" className="flex flex-wrap gap-1.5">
      {WF_STATES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={value === s.id}
          data-testid={`wf-state-${s.id}`}
          onClick={() => onChange(s.id)}
          className={`min-h-[44px] sm:min-h-[32px] rounded-md border px-2.5 py-1 text-xs transition-colors ${
            value === s.id
              ? 'border-emerald-500 bg-emerald-600 text-white'
              : 'border-edge bg-surface text-secondary hover:border-emerald-500/60'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** Layout switcher across the three candidates. */
export function LayoutPicker({ value, options, onChange }: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div role="group" aria-label="Candidate layout" data-testid="wf-layout-picker" className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          data-testid={`wf-layout-${o.id}`}
          onClick={() => onChange(o.id)}
          className={`min-h-[44px] sm:min-h-[36px] rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            value === o.id
              ? 'border-emerald-500 bg-emerald-600 text-white'
              : 'border-edge bg-surface text-foreground hover:border-emerald-500/60'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** In-page rationale + trade-offs for one candidate. */
export function Rationale({ pitch, wins, costs }: { pitch: string; wins: string[]; costs: string[] }): JSX.Element {
  return (
    <div data-testid="wf-rationale" className="rounded-lg border border-edge bg-surface p-3">
      <p className="text-sm text-foreground">{pitch}</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-emerald-400">Wins</div>
          <ul className="mt-1 space-y-0.5 text-xs text-secondary">
            {wins.map((w) => <li key={w}>· {w}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-amber-400">Trade-offs</div>
          <ul className="mt-1 space-y-0.5 text-xs text-secondary">
            {costs.map((c) => <li key={c}>· {c}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Stacked initials standing in for `MemberAvatarGroup`. */
export function Faces({ names, max = 4 }: { names: string[]; max?: number }): JSX.Element {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span className="inline-flex items-center" aria-label={`${names.length} voters`}>
      {shown.map((n, i) => (
        <span
          key={n}
          style={{ marginLeft: i === 0 ? 0 : -6 }}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-edge bg-overlay text-[9px] text-secondary"
        >
          {n.slice(0, 1)}
        </span>
      ))}
      {rest > 0 && <span className="ml-1 text-[10px] text-muted">+{rest}</span>}
    </span>
  );
}

/** Status pill using the shared Discord/web grammar (P-5). */
export function StatusPill({ text, tone }: { text: string; tone: 'open' | 'locked' | 'closed' }): JSX.Element {
  const cls = {
    open: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    locked: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    closed: 'border-edge bg-overlay/50 text-muted',
  }[tone];
  return (
    <span data-testid="wf-status" className={`inline-block rounded border px-2 py-0.5 font-mono text-[11px] ${cls}`}>
      {text}
    </span>
  );
}

/** Read-only chip that links somewhere in the real page. */
export function Chip({ children }: { children: ReactNode }): JSX.Element {
  return <span className={NAV_CHIP_CLASS}>{children}</span>;
}

/** Horizontal vote bar normalised to the poll's member count. */
export function VoteBar({ votes, members }: { votes: number; members: number }): JSX.Element {
  const pct = members === 0 ? 0 : Math.round((votes / members) * 100);
  return (
    <span className="inline-block h-1.5 w-full overflow-hidden rounded bg-overlay/60" aria-hidden="true">
      <span className="block h-full rounded bg-emerald-500/70" style={{ width: `${pct}%` }} />
    </span>
  );
}
