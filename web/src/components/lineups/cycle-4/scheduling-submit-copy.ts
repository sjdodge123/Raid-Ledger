/**
 * Copy + state helpers for the ROK-1300 Scheduling composite sticky-toolbar
 * submit ritual.
 *
 * The submit affordance lives in the sticky JourneyHero toolbar (NOT a bottom
 * `<SubmitBar>` — see the dev brief's divergence note). Its label switches on
 * the viewer's submit state and the poll mode:
 *   - from-match, unsubmitted → "Submit my times →"
 *   - standalone, unsubmitted → "Lock this time →"
 *   - post (either mode)      → "Change my times"
 */
import { deriveSubmitKind, type SubmitKind } from '../../shared/submit-bar/derive-kind';

/** Poll mode — drives the unsubmitted submit label. */
export type SchedulingMode = 'from-match' | 'standalone';

/** Resolve the poll mode from the contract's `isStandalone` flag. */
export function schedulingModeFor(isStandalone: boolean): SchedulingMode {
  return isStandalone ? 'standalone' : 'from-match';
}

/** Input to {@link deriveScheduleSubmitKind}. */
export interface ScheduleSubmitInput {
  /** Viewer's per-match `schedulingSubmittedAt` (ISO) or null. */
  submittedAt: string | null;
  /** Slot IDs the viewer has voted on (no per-vote max in scheduling). */
  myVotedSlotIds: number[];
}

/** Derive the SubmitBar visual kind for the scheduling phase. */
export function deriveScheduleSubmitKind(
  input: ScheduleSubmitInput,
): SubmitKind {
  const hasAction = input.myVotedSlotIds.length > 0;
  return deriveSubmitKind({
    submittedAt: input.submittedAt,
    hasAnyAction: hasAction,
    hasFullAction: hasAction,
  });
}

/** Sticky-toolbar submit button label for a kind + mode. */
export function submitCopy(kind: SubmitKind, mode: SchedulingMode): string {
  if (kind === 'post') return 'Change my times';
  if (mode === 'standalone') return 'Lock this time →';
  return 'Submit my times →';
}

/** Nudge line under the submit button when no times are selected yet. */
export function submitNudge(kind: SubmitKind): string | undefined {
  if (kind === 'empty') return 'Pick a time first to submit.';
  return undefined;
}
