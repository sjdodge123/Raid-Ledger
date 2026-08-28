/**
 * Shared absence components and hook for game time (ROK-999).
 * Used by GameTimePanel (profile), SchedulingWizard, and FTE onboarding.
 */
import { useState, useCallback, useMemo } from 'react';
import type { JSX } from 'react';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences } from '../../../hooks/use-game-time';
import { toast } from '../../../lib/toast';
import { quickRange, spanDays, spanLabel, type QuickRangeKind } from './absence-dates.utils';

const INPUT_CLS = 'w-full min-w-0 px-2 py-2 text-sm bg-surface border border-edge-strong rounded-lg text-foreground focus:border-emerald-500 focus:outline-none';

const QUICK_PICKS: Array<{ kind: QuickRangeKind; label: string }> = [
    { kind: 'weekend', label: 'This weekend' },
    { kind: 'next-week', label: 'Next week' },
];

/**
 * Which preset the current dates correspond to, derived rather than stored so
 * AbsenceState keeps its shape (ROK-1426).
 */
function activePick(startDate: string, endDate: string, today: Date): QuickRangeKind | 'custom' | null {
    if (!startDate && !endDate) return null;
    const hit = QUICK_PICKS.find((p) => {
        const r = quickRange(p.kind, today);
        return r.startDate === startDate && r.endDate === endDate;
    });
    return hit ? hit.kind : 'custom';
}

export interface AbsenceState {
  show: boolean;
  startDate: string;
  endDate: string;
  reason: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const ABSENCE_INITIAL: AbsenceState = { show: false, startDate: '', endDate: '', reason: '' };

/**
 * Absence form (ROK-1426 mobile pass).
 *
 * Was a flex-wrap row of two date inputs, a free-text reason and a submit
 * button, which collapsed into a cramped stack at 375px. Now: presets for the
 * two common cases, full-width stacked fields behind a fixed label column, and
 * an inclusive day count so a mistyped range is obvious before it is saved.
 */
export function AbsenceForm({ state, onChange, onSubmit, isPending }: {
    state: AbsenceState; onChange: (s: Partial<AbsenceState>) => void; onSubmit: () => void; isPending: boolean;
}): JSX.Element {
    const today = useMemo(() => new Date(), []);
    const active = activePick(state.startDate, state.endDate, today);
    const span = spanLabel(state.startDate, state.endDate);
    const canSubmit = spanDays(state.startDate, state.endDate) > 0 && !isPending;

    return (
        <div className="mb-4 p-3 sm:p-4 rounded-lg border border-edge bg-panel/50 flex flex-col gap-3">
            <h3 className="text-sm font-medium text-foreground">New Absence</h3>

            <div className="flex gap-2" role="group" aria-label="Absence presets">
                {QUICK_PICKS.map(({ kind, label }) => (
                    <PickChip
                        key={kind} label={label} isActive={active === kind}
                        onClick={() => onChange(quickRange(kind, today))}
                        testId={`absence-pick-${kind}`}
                    />
                ))}
                <PickChip
                    label="Custom" isActive={active === 'custom'}
                    onClick={() => onChange({ startDate: '', endDate: '' })}
                    testId="absence-pick-custom"
                />
            </div>

            <Field label="From" htmlFor="absence-from">
                <input
                    id="absence-from" type="date" className={INPUT_CLS} value={state.startDate}
                    onChange={(e) => onChange({ startDate: e.target.value })}
                />
            </Field>
            <Field label="To" htmlFor="absence-to">
                <input
                    id="absence-to" type="date" className={INPUT_CLS} value={state.endDate}
                    min={state.startDate || undefined}
                    onChange={(e) => onChange({ endDate: e.target.value })}
                />
            </Field>
            <Field label="Reason" htmlFor="absence-reason">
                <input
                    id="absence-reason" type="text" maxLength={255}
                    className={`${INPUT_CLS} placeholder-dim`} value={state.reason}
                    placeholder="Optional, e.g. Vacation"
                    onChange={(e) => onChange({ reason: e.target.value })}
                />
            </Field>

            <div className="flex items-center gap-3">
                <span className="text-xs text-muted tabular-nums" data-testid="absence-span">{span}</span>
                <button
                    onClick={onSubmit} disabled={!canSubmit}
                    className="ml-auto px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-overlay disabled:text-muted text-foreground text-sm font-medium rounded-lg transition-colors"
                    data-testid="absence-submit"
                >
                    {isPending ? 'Saving...' : 'Add Absence'}
                </button>
            </div>
        </div>
    );
}

function PickChip({ label, isActive, onClick, testId }: {
    label: string; isActive: boolean; onClick: () => void; testId: string;
}): JSX.Element {
    return (
        <button
            type="button" onClick={onClick} aria-pressed={isActive} data-testid={testId}
            className={`flex-1 px-2 py-2 text-xs font-medium rounded-lg border transition-colors ${
                isActive
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : 'border-edge-strong bg-surface text-muted hover:text-foreground'
            }`}
        >
            {label}
        </button>
    );
}

/** Fixed label column keeps the control full-width instead of wrapping. */
function Field({ label, htmlFor, children }: {
    label: string; htmlFor: string; children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="flex items-center gap-3">
            <label htmlFor={htmlFor} className="w-14 shrink-0 text-xs text-muted">{label}</label>
            {children}
        </div>
    );
}

export function AbsenceList({ absences, onDelete, isDeleting }: {
  absences: Array<{ id: number; startDate: string; endDate: string; reason?: string | null }>;
  onDelete: (id: number) => void; isDeleting: boolean;
}): JSX.Element {
  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:flex-wrap gap-2">
      {absences.map((absence) => (
        <AbsencePill key={absence.id} absence={absence} onDelete={onDelete} isDeleting={isDeleting} />
      ))}
    </div>
  );
}

/** Shared hook for absence CRUD with all-absences query, sorted by startDate. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAbsenceSection() {
  const [absence, setAbsence] = useState<AbsenceState>(ABSENCE_INITIAL);
  const create = useCreateAbsence();
  const del = useDeleteAbsence();
  const { data: all } = useGameTimeAbsences();
  const sorted = [...(all ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const handleCreate = useCallback(async () => {
    if (!absence.startDate || !absence.endDate) return;
    try {
      await create.mutateAsync({ startDate: absence.startDate, endDate: absence.endDate, reason: absence.reason || undefined });
      setAbsence(ABSENCE_INITIAL);
      toast.success('Absence created');
    } catch { toast.error('Failed to create absence'); }
  }, [absence, create]);

  const handleDelete = useCallback((id: number) => del.mutate(id), [del]);

  return { absence, setAbsence, handleCreate, handleDelete, isPending: create.isPending, isDeleting: del.isPending, absences: sorted };
}

/** Drop-in absence section: toggle button + form + chip list. */
export function AbsenceSection(): JSX.Element {
  const abs = useAbsenceSection();
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => abs.setAbsence((s) => ({ ...s, show: !s.show }))}
        className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors bg-red-600 text-foreground hover:bg-red-500">
        {abs.absence.show ? 'Cancel' : 'Add Absence'}
      </button>
      {abs.absence.show && <AbsenceForm state={abs.absence} onChange={(p) => abs.setAbsence((s) => ({ ...s, ...p }))} onSubmit={abs.handleCreate} isPending={abs.isPending} />}
      {abs.absences.length > 0 && <AbsenceList absences={abs.absences} onDelete={abs.handleDelete} isDeleting={abs.isDeleting} />}
    </div>
  );
}

function AbsencePill({ absence, onDelete, isDeleting }: {
  absence: { id: number; startDate: string; endDate: string; reason?: string | null };
  onDelete: (id: number) => void; isDeleting: boolean;
}): JSX.Element {
  return (
    <div className="flex sm:inline-flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-sm">
      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      <span className="text-red-300 flex-1 sm:flex-none">
        {absence.startDate} — {absence.endDate}
        {absence.reason && <span className="text-red-400/70 ml-1">({absence.reason})</span>}
      </span>
      <button onClick={() => onDelete(absence.id)} disabled={isDeleting} className="text-red-400/60 hover:text-red-300 transition-colors ml-1" title="Remove absence">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
