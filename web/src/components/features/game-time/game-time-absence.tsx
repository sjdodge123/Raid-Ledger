/**
 * Shared absence components for game time (ROK-999).
 * Used by GameTimePanel (profile settings) and SchedulingWizard.
 */
import type { JSX } from 'react';

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
