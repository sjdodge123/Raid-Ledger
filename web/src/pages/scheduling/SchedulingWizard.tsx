/**
 * Scheduling Wizard (ROK-999).
 * 3-step inline wizard guiding users through the scheduling poll flow.
 * Step 1: Set Gametime (auto-skipped if fresh)
 * Step 2: Vote on Times (auto-skipped if no slots exist)
 * Step 3: Suggest a Time (user-skipped by not adding one)
 */
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { GameTimeGrid } from '../../components/features/game-time/GameTimeGrid';
import { AbsenceForm, AbsenceList, ABSENCE_INITIAL } from '../../components/features/game-time/game-time-absence';
import type { AbsenceState } from '../../components/features/game-time/game-time-absence';
import { useGameTimeEditor } from '../../hooks/use-game-time-editor';
import { useCreateAbsence, useDeleteAbsence, useGameTimeAbsences, GAME_TIME_QUERY_KEY } from '../../hooks/use-game-time';
import { useToggleScheduleVote, useSuggestSlot } from '../../hooks/use-scheduling';
import { setWizardSkipped } from './scheduling-wizard-utils';
import { toast } from '../../lib/toast';

const STEPS = [
  { key: 'gametime', label: 'Set Gametime', number: 1 },
  { key: 'vote', label: 'Vote on Times', number: 2 },
  { key: 'suggest', label: 'Suggest a Time', number: 3 },
] as const;

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

function stepStatus(idx: number, current: number): 'active' | 'completed' | 'upcoming' {
  return idx < current ? 'completed' : idx === current ? 'active' : 'upcoming';
}

function CheckIcon(): JSX.Element {
  return (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function StepCircle({ step, status }: {
  step: typeof STEPS[number]; status: 'active' | 'completed' | 'upcoming';
}): JSX.Element {
  const cls = status === 'active'
    ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/50'
    : status === 'completed' ? 'bg-emerald-600/30 text-emerald-400'
      : 'bg-surface/50 text-muted border border-edge/50';
  return (
    <div className="flex items-center gap-2">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${cls}`}>
        {status === 'completed' ? <CheckIcon /> : step.number}
      </div>
      <span className={`text-sm font-medium ${status === 'active' ? 'text-foreground' : 'text-muted'}`}>{step.label}</span>
    </div>
  );
}

function WizardStepIndicator({ currentStep }: { currentStep: number }): JSX.Element {
  return (
    <div data-testid="wizard-step-indicator">
      <div className="flex items-center justify-between md:hidden">
        <span className="text-sm text-muted">Step {Math.min(currentStep + 1, STEPS.length)} of {STEPS.length}</span>
        <span className="text-sm font-medium text-foreground">{STEPS[Math.min(currentStep, STEPS.length - 1)].label}</span>
      </div>
      <div className="hidden md:flex items-center gap-2">
        {STEPS.map((step, idx) => (
          <div key={step.key} className="flex items-center" data-testid={`wizard-step-${idx + 1}`} data-status={stepStatus(idx, currentStep)}>
            <StepCircle step={step} status={stepStatus(idx, currentStep)} />
            {idx < STEPS.length - 1 && <div className={`w-8 h-px ml-2 ${idx < currentStep ? 'bg-emerald-600/50' : 'bg-edge/50'}`} />}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function WizardNav({ onContinue, onSkip, continueLabel, skipLabel, disabled, isPending }: {
  onContinue: () => void; onSkip?: () => void; continueLabel: string; skipLabel?: string; disabled?: boolean; isPending?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      <button type="button" onClick={onContinue} disabled={disabled}
        className="w-full md:w-auto px-6 py-2.5 min-h-[44px] text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50">
        {isPending ? 'Saving...' : continueLabel}
      </button>
      {onSkip && <button type="button" onClick={onSkip} className="min-h-[44px] px-4 py-2 text-sm text-muted hover:text-foreground transition-colors">{skipLabel ?? 'Skip'}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Set Gametime
// ---------------------------------------------------------------------------

function useWizardAbsence() {
  const [absence, setAbsence] = useState<AbsenceState>(ABSENCE_INITIAL);
  const create = useCreateAbsence();
  const del = useDeleteAbsence();
  const { data: all } = useGameTimeAbsences();
  const sorted = [...(all ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const handleCreate = async () => {
    if (!absence.startDate || !absence.endDate) return;
    try { await create.mutateAsync({ startDate: absence.startDate, endDate: absence.endDate, reason: absence.reason || undefined }); setAbsence(ABSENCE_INITIAL); toast.success('Absence created'); }
    catch { toast.error('Failed to create absence'); }
  };
  return { absence, setAbsence, handleCreate, handleDelete: (id: number) => del.mutate(id), isPending: create.isPending, isDeleting: del.isPending, absences: sorted };
}

function WizardAbsenceSection({ abs }: { abs: ReturnType<typeof useWizardAbsence> }): JSX.Element {
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

function GameTimeWizardStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }): JSX.Element {
  const editor = useGameTimeEditor();
  const qc = useQueryClient();
  const abs = useWizardAbsence();
  const handleSave = async () => {
    await editor.save();
    qc.invalidateQueries({ queryKey: ['scheduling'] });
    qc.invalidateQueries({ queryKey: GAME_TIME_QUERY_KEY });
    onNext();
  };
  if (editor.isLoading) return <div className="text-center py-8"><div className="w-8 h-8 mx-auto mb-2 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;
  return (
    <div data-testid="scheduling-wizard-step-1" className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">When Do You Play?</h2>
        <p className="text-muted text-sm mt-1">Paint your weekly availability so the group can find the best time.</p>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-edge">
        <GameTimeGrid slots={editor.slots} onChange={editor.handleChange} tzLabel={editor.tzLabel} hourRange={[6, 24]} compact noStickyOffset fullDayNames />
      </div>
      <WizardAbsenceSection abs={abs} />
      <WizardNav onContinue={handleSave} onSkip={onSkip} continueLabel="Save & Continue" skipLabel="Skip" isPending={editor.isSaving} disabled={editor.isSaving || (!editor.isDirty && editor.slots.length === 0)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Vote on existing slots
// ---------------------------------------------------------------------------

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function VoteStep({ poll, lineupId, matchId, onNext }: {
  poll: SchedulePollPageResponseDto; lineupId: number; matchId: number; onNext: () => void;
}): JSX.Element {
  const toggle = useToggleScheduleVote();
  const [voted, setVoted] = useState<number[]>(poll.myVotedSlotIds);
  const handleToggle = (slotId: number) => {
    toggle.mutate({ lineupId, matchId, slotId });
    setVoted((ids) => ids.includes(slotId) ? ids.filter((id) => id !== slotId) : [...ids, slotId]);
  };
  return (
    <div data-testid="scheduling-wizard-step-2" className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">Vote on Suggested Times</h2>
        <p className="text-muted text-sm mt-1">Tap the times that work for you.</p>
      </div>
      <div className="space-y-2">
        {poll.slots.map((slot) => {
          const isVoted = voted.includes(slot.id);
          return (
            <button key={slot.id} type="button" onClick={() => handleToggle(slot.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${isVoted ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-panel border-edge text-foreground hover:border-dim'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{formatSlotTime(slot.proposedTime)}</span>
                <span className="text-xs text-muted">{slot.votes.length} {slot.votes.length === 1 ? 'vote' : 'votes'}</span>
              </div>
              {isVoted && <p className="text-xs text-emerald-400 mt-1">You voted</p>}
            </button>
          );
        })}
      </div>
      <WizardNav onContinue={onNext} continueLabel="Continue" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Suggest a new time
// ---------------------------------------------------------------------------

function SuggestStep({ lineupId, matchId, onDone }: {
  lineupId: number; matchId: number; onDone: () => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const suggest = useSuggestSlot();
  const handleSubmit = () => {
    if (!value) return;
    suggest.mutate({ lineupId, matchId, proposedTime: new Date(value).toISOString() }, { onSuccess: () => { setValue(''); toast.success('Time suggested'); onDone(); } });
  };
  return (
    <div data-testid="scheduling-wizard-step-3" className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">Suggest a New Time</h2>
        <p className="text-muted text-sm mt-1">Have a better time in mind? Suggest it for the group.</p>
      </div>
      <div className="flex items-center gap-2">
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)}
          className="flex-1 px-3 py-2 bg-panel border border-edge rounded-lg text-sm text-foreground focus:ring-2 focus:ring-emerald-500 focus:outline-none" />
        <button type="button" onClick={handleSubmit} disabled={!value || suggest.isPending}
          className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50">
          {suggest.isPending ? 'Adding...' : 'Suggest'}
        </button>
      </div>
      <WizardNav onContinue={onDone} continueLabel="Done" onSkip={onDone} skipLabel="Skip" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard Shell
// ---------------------------------------------------------------------------

export interface SchedulingWizardProps {
  children: ReactNode;
  poll: SchedulePollPageResponseDto;
  lineupId: number;
  matchId: number;
  /** true when game time is stale / needs refresh. */
  gameTimeStale: boolean;
}

function computeInitialStep(gameTimeStale: boolean, hasSlots: boolean): number {
  if (gameTimeStale) return 0;
  if (hasSlots) return 1;
  return 2;
}

export function SchedulingWizard({ children, poll, lineupId, matchId, gameTimeStale }: SchedulingWizardProps): JSX.Element {
  const hasSlots = poll.slots.length > 0;
  const [step, setStep] = useState(() => computeInitialStep(gameTimeStale, hasSlots));
  const done = step >= STEPS.length;

  const advance = () => {
    const next = step + 1;
    // Auto-skip Step 2 if no slots
    if (next === 1 && !hasSlots) { setStep(2); return; }
    setStep(next);
  };

  const skipStep1 = () => { setWizardSkipped(); advance(); };

  if (done) return <>{children}</>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <WizardStepIndicator currentStep={step} />
      {step === 0 && <GameTimeWizardStep onNext={advance} onSkip={skipStep1} />}
      {step === 1 && <VoteStep poll={poll} lineupId={lineupId} matchId={matchId} onNext={advance} />}
      {step === 2 && <SuggestStep lineupId={lineupId} matchId={matchId} onDone={advance} />}
    </div>
  );
}
