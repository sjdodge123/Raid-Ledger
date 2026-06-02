/**
 * Scheduling Wizard (ROK-999, collapsed to 2 steps in ROK-1301).
 * 2-step inline wizard guiding users through the scheduling poll flow.
 * Step 1: Vote on Times (auto-skipped if no slots exist)
 * Step 2: Suggest a Time (user-skipped by not adding one)
 *
 * The former Step 1 "Set Gametime" painter moved into GameTimeRefreshModal,
 * mounted on the poll page — weekly availability is now a profile setting, not a
 * per-poll wizard step.
 */
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useToggleScheduleVote } from '../../hooks/use-scheduling';
import { MemberAvatarGroup } from '../../components/lineups/decided/MemberAvatarGroup';

const STEPS = [
  { key: 'vote', label: 'Vote on Times', number: 1 },
  { key: 'suggest', label: 'Suggest a Time', number: 2 },
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

function StepCircle({ step, status, onClick }: {
  step: typeof STEPS[number]; status: 'active' | 'completed' | 'upcoming'; onClick?: () => void;
}): JSX.Element {
  const cls = status === 'active'
    ? 'bg-emerald-600 text-white ring-2 ring-emerald-500/50'
    : status === 'completed' ? 'bg-emerald-600/30 text-emerald-400'
      : 'bg-surface/50 text-muted border border-edge/50';
  const clickable = status !== 'active' && onClick;
  return (
    <button type="button" onClick={clickable ? onClick : undefined} disabled={!clickable}
      className={`flex items-center gap-2 ${clickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${cls}`}>
        {status === 'completed' ? <CheckIcon /> : step.number}
      </div>
      <span className={`text-sm font-medium ${status === 'active' ? 'text-foreground' : 'text-muted'}`}>{step.label}</span>
    </button>
  );
}

function WizardStepIndicator({ currentStep, onGoTo }: { currentStep: number; onGoTo: (step: number) => void }): JSX.Element {
  return (
    <div data-testid="wizard-step-indicator">
      <div className="flex items-center justify-between md:hidden">
        <span className="text-sm text-muted">Step {Math.min(currentStep + 1, STEPS.length)} of {STEPS.length}</span>
        <span className="text-sm font-medium text-foreground">{STEPS[Math.min(currentStep, STEPS.length - 1)].label}</span>
      </div>
      <div className="hidden md:flex items-center justify-center gap-2">
        {STEPS.map((step, idx) => (
          <div key={step.key} className="flex items-center" data-testid={`wizard-step-${idx + 1}`} data-status={stepStatus(idx, currentStep)}>
            <StepCircle step={step} status={stepStatus(idx, currentStep)} onClick={() => onGoTo(idx)} />
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
// Step 1: Vote on existing slots
// ---------------------------------------------------------------------------

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Stripe-card notice: weekly availability is now a profile setting (ROK-1301). */
function SavedGameTimeNotice(): JSX.Element {
  return (
    <div className="p-3 rounded-lg bg-panel/50 border border-edge text-sm">
      <p className="text-foreground">
        Using your saved Game Time — edit anytime in{' '}
        <Link to="/profile/gaming/game-time" className="text-emerald-300 underline hover:text-emerald-200">
          profile settings
        </Link>
        .
      </p>
      <p className="text-xs text-muted mt-1">Update once, applies to every lineup.</p>
    </div>
  );
}

function VoteStep({ poll, lineupId, matchId, onNext }: {
  poll: SchedulePollPageResponseDto; lineupId: number; matchId: number; onNext: () => void;
}): JSX.Element {
  const toggle = useToggleScheduleVote();
  const [optimistic, setOptimistic] = useState<Set<number>>(new Set());
  const voted = poll.myVotedSlotIds.includes.bind(poll.myVotedSlotIds);
  const isVoted = (id: number) => optimistic.has(id) !== voted(id);
  const handleToggle = (slotId: number) => {
    toggle.mutate({ lineupId, matchId, slotId }, {
      onError: () => setOptimistic((s) => { const n = new Set(s); n.delete(slotId); return n; }),
    });
    setOptimistic((s) => { const n = new Set(s); if (n.has(slotId)) n.delete(slotId); else n.add(slotId); return n; });
  };
  const pending = toggle.isPending;
  return (
    <div data-testid="scheduling-wizard-step-1" className="space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-bold text-foreground">Vote on Suggested Times</h2>
        <p className="text-muted text-sm mt-1">Tap the times that work for you.</p>
      </div>
      <SavedGameTimeNotice />
      <div className="space-y-2">
        {poll.slots.map((slot) => {
          const slotVoted = isVoted(slot.id);
          return (
            <button key={slot.id} type="button" disabled={pending} onClick={() => handleToggle(slot.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${slotVoted ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-panel border-edge text-foreground hover:border-dim'}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{formatSlotTime(slot.proposedTime)}</span>
                <span className="text-xs text-muted">{slot.votes.length} {slot.votes.length === 1 ? 'vote' : 'votes'}</span>
              </div>
              {slot.votes.length > 0 && (
                <div className="mt-1.5">
                  <MemberAvatarGroup members={slot.votes} max={5} />
                </div>
              )}
              {slotVoted && <p className="text-xs text-emerald-400 mt-1">You voted</p>}
            </button>
          );
        })}
      </div>
      <WizardNav onContinue={onNext} continueLabel="Continue" />
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
}

/** Vote (step 0) when slots exist, else jump straight to Suggest (step 1). */
function computeInitialStep(hasSlots: boolean): number {
  return hasSlots ? 0 : 1;
}

export function SchedulingWizard({ children, poll, lineupId, matchId }: SchedulingWizardProps): JSX.Element {
  const hasSlots = poll.slots.length > 0;
  const [step, setStep] = useState(() => computeInitialStep(hasSlots));

  const advance = () => setStep(Math.min(step + 1, STEPS.length - 1));
  const goTo = (target: number) => { if (target !== step) setStep(target); };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-20 md:pb-0 space-y-6">
      <WizardStepIndicator currentStep={step} onGoTo={goTo} />
      {step === 0 && <VoteStep poll={poll} lineupId={lineupId} matchId={matchId} onNext={advance} />}
      {step === 1 && children}
    </div>
  );
}
