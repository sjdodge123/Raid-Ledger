/**
 * Scheduling Wizard (ROK-999).
 * 2-step inline wizard: Step 1 = set game time, Step 2 = vote on times.
 * Shows when gameTimeStale is true (user hasn't confirmed availability in 7+ days).
 */
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GameTimeGrid } from '../../components/features/game-time/GameTimeGrid';
import { AbsenceForm, AbsenceList, ABSENCE_INITIAL } from '../../components/features/game-time/game-time-absence';
import type { AbsenceState } from '../../components/features/game-time/game-time-absence';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences, GAME_TIME_QUERY_KEY } from '../../hooks/use-game-time';
import { setWizardSkipped } from './scheduling-wizard-utils';
import { toast } from '../../lib/toast';

const STEPS = [
  { key: 'gametime', label: 'Set Gametime', number: 1 },
  { key: 'vote', label: 'Vote on Times', number: 2 },
] as const;

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function StepCircle({ step, status }: {
  step: typeof STEPS[number]; status: 'active' | 'completed' | 'upcoming';
}): JSX.Element {
  const circleClass = status === 'active'
    ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/50'
    : status === 'completed'
      ? 'bg-emerald-600/30 text-emerald-400'
      : 'bg-surface/50 text-muted border border-edge/50';

  return (
    <div className="flex items-center gap-2">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${circleClass}`}>
        {status === 'completed' ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        ) : step.number}
      </div>
      <span className={`text-sm font-medium ${status === 'active' ? 'text-foreground' : 'text-muted'}`}>
        {step.label}
      </span>
    </div>
  );
}

function WizardStepIndicator({ currentStep }: { currentStep: number }): JSX.Element {
  const stepStatus = (idx: number) =>
    idx < currentStep ? 'completed' : idx === currentStep ? 'active' : 'upcoming';

  return (
    <div data-testid="wizard-step-indicator">
      {/* Mobile: text only */}
      <div className="flex items-center justify-between md:hidden">
        <span className="text-sm text-muted">Step {currentStep + 1} of {STEPS.length}</span>
        <span className="text-sm font-medium text-foreground">{STEPS[currentStep].label}</span>
      </div>
      {/* Desktop: numbered circles */}
      <div className="hidden md:flex items-center gap-2">
        {STEPS.map((step, idx) => (
          <div key={step.key} className="flex items-center" data-testid={`wizard-step-${idx + 1}`} data-status={stepStatus(idx)}>
            <StepCircle step={step} status={stepStatus(idx)} />
            {idx < STEPS.length - 1 && (
              <div className={`w-8 h-px ml-2 ${idx < currentStep ? 'bg-emerald-600/50' : 'bg-edge/50'}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game Time Step (Step 1)
// ---------------------------------------------------------------------------

function WizardLoading(): JSX.Element {
  return (
    <div className="text-center py-8">
      <div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-dim text-sm">Loading your availability...</p>
    </div>
  );
}

function WizardActions({ onSave, onSkip, isSaving, disabled }: {
  onSave: () => void; onSkip: () => void; isSaving: boolean; disabled: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <button type="button" onClick={onSave} disabled={disabled}
        className="w-full md:w-auto px-6 py-2.5 min-h-[44px] text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50">
        {isSaving ? 'Saving...' : 'Save & Continue'}
      </button>
      <button type="button" onClick={onSkip}
        className="min-h-[44px] px-4 py-2 text-sm text-muted hover:text-foreground transition-colors">
        Skip
      </button>
    </div>
  );
}

function useWizardAbsence() {
  const [absence, setAbsence] = useState<AbsenceState>(ABSENCE_INITIAL);
  const createAbsence = useCreateAbsence();
  const deleteAbsence = useDeleteAbsence();
  const { data: allAbsences } = useGameTimeAbsences();
  const sorted = [...(allAbsences ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const handleCreate = async () => {
    if (!absence.startDate || !absence.endDate) return;
    try {
      await createAbsence.mutateAsync({ startDate: absence.startDate, endDate: absence.endDate, reason: absence.reason || undefined });
      setAbsence(ABSENCE_INITIAL);
      toast.success('Absence created');
    } catch { toast.error('Failed to create absence'); }
  };

  const handleDelete = async (id: number) => {
    try { await deleteAbsence.mutateAsync(id); toast.success('Absence removed'); }
    catch { toast.error('Failed to remove absence'); }
  };

  return { absence, setAbsence, handleCreate, handleDelete, isPending: createAbsence.isPending, isDeleting: deleteAbsence.isPending, absences: sorted };
}

function WizardAbsenceSection({ abs }: { abs: ReturnType<typeof useWizardAbsence> }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => abs.setAbsence((s) => ({ ...s, show: !s.show }))}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors bg-red-600 text-foreground hover:bg-red-500">
          {abs.absence.show ? 'Cancel' : 'Add Absence'}
        </button>
      </div>
      {abs.absence.show && <AbsenceForm state={abs.absence} onChange={(p) => abs.setAbsence((s) => ({ ...s, ...p }))} onSubmit={abs.handleCreate} isPending={abs.isPending} />}
      {abs.absences.length > 0 && <AbsenceList absences={abs.absences} onDelete={abs.handleDelete} isDeleting={abs.isDeleting} />}
    </div>
  );
}

function GameTimeWizardStep({ onSave, onSkip }: {
  onSave: () => void; onSkip: () => void;
}): JSX.Element {
  const editor = useGameTimeEditor();
  const qc = useQueryClient();
  const abs = useWizardAbsence();

  const handleSaveAndContinue = async () => {
    await editor.save();
    qc.invalidateQueries({ queryKey: ['scheduling'] });
    qc.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
    onSave();
  };

  if (editor.isLoading) return <WizardLoading />;

  return (
    <div data-testid="scheduling-wizard-step-1" className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">When Do You Play?</h2>
        <p className="text-muted text-sm mt-1">
          Paint your weekly availability so the group can find the best time.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-edge">
        <GameTimeGrid
          slots={editor.slots} onChange={editor.handleChange} tzLabel={editor.tzLabel}
          hourRange={[6, 24]} compact noStickyOffset fullDayNames
        />
      </div>
      <WizardAbsenceSection abs={abs} />
      <WizardActions onSave={handleSaveAndContinue} onSkip={onSkip}
        isSaving={editor.isSaving} disabled={editor.isSaving || (!editor.isDirty && editor.slots.length === 0)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard Shell
// ---------------------------------------------------------------------------

interface SchedulingWizardProps {
  children: ReactNode;
  onSkip: () => void;
}

export function SchedulingWizard({ children, onSkip }: SchedulingWizardProps): JSX.Element {
  const [step, setStep] = useState(0);

  const handleSave = () => setStep(1);

  const handleSkip = () => {
    setWizardSkipped();
    onSkip();
    setStep(1);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <WizardStepIndicator currentStep={step} />
      {step === 0
        ? <GameTimeWizardStep onSave={handleSave} onSkip={handleSkip} />
        : children}
    </div>
  );
}

