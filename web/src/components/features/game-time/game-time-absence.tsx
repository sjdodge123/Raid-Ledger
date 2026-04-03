/**
 * Shared absence components and hook for game time (ROK-999).
 * Used by GameTimePanel (profile), SchedulingWizard, and FTE onboarding.
 */
import { useState, useCallback } from 'react';
import type { JSX } from 'react';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences } from '../../../hooks/use-game-time';
import { toast } from '../../../lib/toast';

const DATE_INPUT_CLS = 'px-2 py-1.5 text-sm bg-surface border border-edge-strong rounded-lg text-foreground focus:border-emerald-500 focus:outline-none';

export interface AbsenceState {
  show: boolean;
  startDate: string;
  endDate: string;
  reason: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const ABSENCE_INITIAL: AbsenceState = { show: false, startDate: '', endDate: '', reason: '' };

export function AbsenceForm({ state, onChange, onSubmit, isPending }: {
  state: AbsenceState; onChange: (s: Partial<AbsenceState>) => void; onSubmit: () => void; isPending: boolean;
}): JSX.Element {
  return (
    <div className="mb-4 p-4 rounded-lg border border-edge bg-panel/50">
      <h3 className="text-sm font-medium text-foreground mb-3">New Absence</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Start Date</label>
          <input type="date" value={state.startDate} onChange={(e) => onChange({ startDate: e.target.value })} className={DATE_INPUT_CLS} />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">End Date</label>
          <input type="date" value={state.endDate} onChange={(e) => onChange({ endDate: e.target.value })} min={state.startDate} className={DATE_INPUT_CLS} />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="block text-xs text-muted mb-1">Reason (optional)</label>
          <input type="text" value={state.reason} onChange={(e) => onChange({ reason: e.target.value })} placeholder="e.g. Vacation, Travel" maxLength={255} className={`w-full ${DATE_INPUT_CLS} placeholder-dim`} />
        </div>
        <button onClick={onSubmit} disabled={!state.startDate || !state.endDate || isPending} className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-overlay disabled:text-muted text-foreground text-sm font-medium rounded-lg transition-colors">
          {isPending ? 'Saving...' : 'Add Absence'}
        </button>
      </div>
    </div>
  );
}

export function AbsenceList({ absences, onDelete, isDeleting }: {
  absences: Array<{ id: number; startDate: string; endDate: string; reason?: string | null }>;
  onDelete: (id: number) => void; isDeleting: boolean;
}): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
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
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-sm">
      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      <span className="text-red-300">
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
