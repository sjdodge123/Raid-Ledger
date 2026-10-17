/**
 * Small reusable UI bits for ROK-1193 wireframes.
 * DEV-ONLY — wireframes only, no production usage.
 */
import type { JSX, ReactNode } from 'react';
import type { PhaseState } from './types';
import { deadlineDescriptor } from './fixtures';

/** Primary CTA — visually loudest, emerald. */
export function PrimaryCta({ children, disabled = false }: {
  children: ReactNode; disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className="px-5 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function SecondaryCta({ children }: { children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      className="px-4 py-2 text-sm font-medium bg-panel text-secondary border border-edge rounded-lg hover:bg-overlay transition-colors"
    >
      {children}
    </button>
  );
}

export function GhostCta({ children }: { children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      className="px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground border border-edge rounded transition-colors"
    >
      {children}
    </button>
  );
}

/** "✓ You voted" pill — sets a target for ROK-1125. */
export function ConfirmationPill({ children }: { children: ReactNode }): JSX.Element {
  return (
    <span
      data-testid="confirmation-pill"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
    >
      <span aria-hidden="true">✓</span>
      {children}
    </span>
  );
}

/** Phase-progress chip ("Step 2 of 4: Voting"). */
export function PhaseStep({ index, total, label }: {
  index: number; total: number; label: string;
}): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 px-2.5 py-1 text-xs rounded-full bg-overlay/50 text-secondary border border-edge">
      <span className="font-semibold text-emerald-300">Step {index} of {total}</span>
      <span className="text-dim">·</span>
      <span>{label}</span>
    </span>
  );
}

/** Phase deadline display — colors per state. */
export function PhaseDeadlineBadge({ phaseState }: { phaseState: PhaseState }): JSX.Element {
  const { countdownLabel, isUrgent, hasExpired } = deadlineDescriptor(phaseState);
  const cls = hasExpired
    ? 'bg-red-500/15 text-red-300 border-red-500/40'
    : isUrgent
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
      : 'bg-overlay/50 text-secondary border-edge';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded border ${cls}`}>
      <ClockIcon />
      {countdownLabel}
    </span>
  );
}

function ClockIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  );
}

/** Banner — variants for last-chance / auto-advance / aborted / privacy / read-only. */
export function StatusBanner({ tone, children }: {
  tone: 'info' | 'urgent' | 'danger' | 'success' | 'amber';
  children: ReactNode;
}): JSX.Element {
  const toneCls = {
    info: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-200',
    urgent: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    danger: 'bg-red-500/10 border-red-500/30 text-red-200',
    success: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
  }[tone];
  return (
    <div role="status" className={`mb-4 px-4 py-3 rounded-lg border text-sm ${toneCls}`}>
      {children}
    </div>
  );
}

/** Game cover thumbnail driven by a hex color. */
export function CoverThumbnail({ name, color, size = 'md' }: {
  name: string; color: string; size?: 'sm' | 'md' | 'lg';
}): JSX.Element {
  const cls = {
    sm: 'w-12 h-16 text-xs',
    md: 'w-16 h-20 text-sm',
    lg: 'w-full aspect-[4/5] text-base',
  }[size];
  return (
    <div
      style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}
      className={`flex-shrink-0 ${cls} rounded-lg flex items-center justify-center text-white font-semibold shadow-md`}
      aria-label={name}
    >
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

/** Vote progress bar (used in voting + decided + standalone poll). */
export function VoteBar({ count, max, color = 'bg-emerald-500' }: {
  count: number; max: number; color?: string;
}): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-overlay/60 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted font-medium tabular-nums">{count}</span>
    </div>
  );
}
