/**
 * Public types for the JourneyHero component (ROK-1294).
 * `phase` is the primary input; `active` is an optional override.
 */
export type HeroTone = 'action' | 'waiting' | 'set';
export type HeroActive = 0 | 1 | 2 | 3 | 4;
export type JourneyPhase = 'nominating' | 'voting' | 'decided' | 'scheduling' | 'done';

export interface UserActions {
  /** nominations_submitted_at IS NOT NULL — ships in U4 (ROK-1296); pass `false` until then */
  hasSubmittedNominations: boolean;
  /** votes_submitted_at IS NOT NULL — ships in U4 (ROK-1296); pass `false` until then */
  hasSubmittedVotes: boolean;
  scheduledMatchCount: number;
  totalMatchCount: number;
}

export interface GroupProgress {
  nominationsSubmitted: number;
  votesSubmitted: number;
  totalVoters: number;
}

export interface LineupConfig {
  nominationQuorum: number;
  votingQuorum: number;
  schedulingAgreementPct: number;
  nominationDeadline?: Date;
  votingDeadline?: Date;
  schedulingDeadline?: Date;
}

export interface HeroState {
  tone: HeroTone;
  exitCondition?: string;
  cue?: string;
}

export interface JourneyHeroProps {
  /**
   * Optional element rendered on the RIGHT of the badge row (below the phase
   * ribbon), next to the done-pill. ROK-1300 uses it for the operator
   * "Cancel Poll" affordance so it sits below the ribbon instead of colliding
   * with the rightmost "Schedule" ribbon node. Coexists with the done-pill.
   */
  headerAction?: import('react').ReactNode;
  /**
   * ROK-1346: optional element rendered top-right of the hero meta region
   * (badge row), to the LEFT of any `headerAction`/done-pill. Used for the
   * lineup "Participants · N" roster button so it sits in the hero across every
   * phase without crowding the ribbon or CTA. Coexists with `headerAction`.
   */
  action?: import('react').ReactNode;
  /** Primary input — drives `active` internally if `active` not supplied */
  phase?: JourneyPhase;
  /** Explicit override / Sx escape hatch — derived from `phase` when omitted */
  active?: HeroActive;
  badge: string;
  task: string;
  /**
   * ROK-1323: now a ReactNode so the lineup composites can fold the title +
   * "Started by…" meta (and an operator ⓘ hover) into the hero sub slot,
   * making the hero the sole top-of-page surface.
   */
  sub?: import('react').ReactNode;
  cta?: string;
  /** Real button handler — wired by consumers. When omitted with `cta` set, button renders disabled. */
  onCtaClick?: () => void;
  hint?: string;
  tone?: HeroTone;
  exitCondition?: string;
  cue?: string;
  donePillLabel?: string;
  noRibbon?: boolean;
  /**
   * ROK-1302: drop the trailing "Schedule" step from the phase ribbon for
   * lineups that opted out of the scheduling phase (terminal at Decided).
   */
  hideSchedulePhase?: boolean;
}
