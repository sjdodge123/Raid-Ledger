/**
 * JourneyHero prop builder for the ROK-1300 Scheduling composite.
 *
 * Two modes, driven by the contract's `poll.isStandalone`:
 *   - from-match (Ss): 4-phase ribbon hero, `phase="scheduling" active={3}`,
 *     badge `Step 4 of 4 · Scheduling[ · Match N of M]`, optional
 *     `Next: <game>` hint.
 *   - standalone (Sx): `noRibbon` hero, badge
 *     `🗓 Scheduling Poll · started by you`, no cross-match refs.
 *
 * Tone flips `action → waiting` once the viewer has submitted their times
 * (JourneyHero then renders the "You're done here" pill).
 */
import type { JourneyHeroProps } from '../../shared/journey-hero/types';
import type { SchedulingMode } from './scheduling-submit-copy';

/** Cross-match reference info (from-match only). */
export interface SchedulingCrossRefs {
  /** 1-based position of this match within the scheduling group. */
  matchIndex: number;
  /** Total scheduling matches in the lineup. */
  matchTotal: number;
  /** Display name of the next match's game, when there is one. */
  nextGameName: string | null;
}

/** Input to {@link buildSchedulingHero}. */
export interface SchedulingHeroInput {
  mode: SchedulingMode;
  /** Viewer has submitted their times for this match. */
  submitted: boolean;
  /** Game name for this match (used in the task line). */
  gameName: string;
  /** Distinct voters on this poll so far. */
  uniqueVoterCount: number;
  /** Total match members (explicit invitees + self-enrolled voters). */
  memberCount: number;
  /** From-match cross-refs; null for standalone. */
  crossRefs: SchedulingCrossRefs | null;
}

/** Build the from-match badge: "Step 4 of 4 · Scheduling[ · Match N of M]". */
function fromMatchBadge(crossRefs: SchedulingCrossRefs | null): string {
  const base = 'Step 4 of 4 · Scheduling';
  if (crossRefs && crossRefs.matchTotal > 1) {
    return `${base} · Match ${crossRefs.matchIndex} of ${crossRefs.matchTotal}`;
  }
  return base;
}

/** From-match `Next: <game>` hint, when a following match exists. */
function nextHint(crossRefs: SchedulingCrossRefs | null): string | undefined {
  if (crossRefs?.nextGameName) return `Next: ${crossRefs.nextGameName}`;
  return undefined;
}

/**
 * Standalone sub-line: participant count + voting progress.
 *
 * Says "in this poll", not "You invited" — voters self-enroll as members
 * on an open-roster poll, so the member count includes people the creator
 * never explicitly invited.
 */
function standaloneSub(input: SchedulingHeroInput): string {
  return `${input.memberCount} ${
    input.memberCount === 1 ? 'person' : 'people'
  } in this poll · ${input.uniqueVoterCount} of ${input.memberCount} have voted on times so far`;
}

/** Build the JourneyHero props for the current poll mode + submit state. */
export function buildSchedulingHero(
  input: SchedulingHeroInput,
): JourneyHeroProps {
  const tone = input.submitted ? 'waiting' : 'action';
  if (input.mode === 'standalone') {
    return {
      noRibbon: true,
      badge: '🗓 Scheduling Poll · started by you',
      task: input.submitted
        ? 'Your times are locked in.'
        : 'Pick a time that works for everyone.',
      sub: standaloneSub(input),
      tone,
    };
  }
  return {
    phase: 'scheduling',
    active: 3,
    badge: fromMatchBadge(input.crossRefs),
    task: input.submitted
      ? 'Your times are submitted.'
      : `Lock in a time for ${input.gameName}.`,
    sub: `${input.uniqueVoterCount} of ${input.memberCount} have voted on times so far.`,
    hint: nextHint(input.crossRefs),
    tone,
  };
}
