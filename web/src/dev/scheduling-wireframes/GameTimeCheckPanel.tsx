/**
 * Candidate B · game-time check (ROK-1555) — DEV-ONLY wireframe harness.
 *
 * The heatmap-as-ballot panel this used to live inside was REJECTED (operator
 * ruling 2026-09-14 17:38Z, recorded in
 * `docs/spikes/rok-1540-scheduling-poll-audit.md`): Layout B's vote ladder is
 * the only ballot, and the sheet's heatmap stays a read-only picking aid that
 * prefills the suggest form. §d's two-step check survives on its own, so this
 * harness renders just that — step 1 asks one question, step 2 is the ladder
 * the epic already ships.
 */
import { useState, type JSX } from 'react';
import { Treatments, Rationale } from './wireframe-chrome';
import { Stepper, StepOne } from './SheetStepOne';
import { pollFor, type WfStateId } from './wireframe-states';

/** Step 2 is not re-drawn here — the shipped ladder (Layout B) is the ballot. */
function LadderStub(): JSX.Element {
  return (
    <p data-testid="wf-gtc-step2" className="rounded border border-edge bg-panel/40 p-2 text-[11px] text-muted">
      Step 2 is Layout B&apos;s vote ladder, unchanged — the only place a vote happens.
    </p>
  );
}

/**
 * Step 1 is FORCED only when the viewer's game time is stale or unknown
 * (`gameTimeStale === true` in the doc's §d); a fresh viewer lands straight on
 * the vote step. 7 days is the wireframe's working threshold — Q-4 in the
 * audit doc (7 vs 30) is still the operator's call.
 */
const STALE_AFTER_DAYS = 7;

/** Where the flow opens for this viewer: the check when stale, else the ballot. */
function startingStep(ageDays: number | null): 1 | 2 {
  return ageDays === null || ageDays > STALE_AFTER_DAYS ? 1 : 2;
}

/** One framed copy of the flow; both treatments render the same component. */
function Flow({ ageDays, onAdvance }: { ageDays: number | null; onAdvance?: () => void }): JSX.Element {
  const [step, setStep] = useState<1 | 2>(() => startingStep(ageDays));
  const advance = (): void => {
    setStep(2);
    onAdvance?.();
  };
  return (
    <div className="rounded-lg border border-edge bg-surface">
      <Stepper step={step} onStep={setStep} />
      <div className="p-2">
        {step === 1 ? <StepOne ageDays={ageDays} onConfirm={advance} onSkip={advance} /> : <LadderStub />}
      </div>
    </div>
  );
}

/**
 * The two-step game-time check, in the desktop and 375px frames every other
 * wireframe panel uses. `onAdvance` is a test seam; the page passes nothing.
 */
export function GameTimeCheckPanel({ state, onAdvance }: {
  state: WfStateId;
  onAdvance?: () => void;
}): JSX.Element {
  const ageDays = pollFor(state).viewerGameTimeAgeDays;
  return (
    <Treatments
      desktop={<div data-testid="wf-gtc-desktop"><Flow ageDays={ageDays} onAdvance={onAdvance} /></div>}
      mobile={<div data-testid="wf-gtc-mobile"><Flow ageDays={ageDays} onAdvance={onAdvance} /></div>}
    />
  );
}

/** Why this panel still exists after the ballot was rejected. */
export function GameTimeCheckRationale(): JSX.Element {
  return (
    <Rationale
      pitch="Two things happen when the poll opens — confirm your week, then vote. They stay two steps."
      wins={[
        'Step 1 asks one question and takes one answer; the week painter never renders inside an overlay.',
        '“Looks right” stamps a confirmation without an edit, which is what most stale viewers actually need.',
        'Skipping is explicit and cheap — the viewer is simply counted as unknown.',
      ]}
      costs={[
        'A fresh viewer sees a step they do not need unless the sheet opens on step 2.',
        'The ballot half is Layout B’s ladder, not drawn here — this panel is deliberately partial.',
      ]}
    />
  );
}
