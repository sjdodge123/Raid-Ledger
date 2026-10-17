import type { GroupProgress, HeroState, JourneyPhase, LineupConfig, UserActions } from './types';
import type { LineupStatusDto } from '@raid-ledger/contract';

interface HeroSelectorInput {
  phase: JourneyPhase;
  userActions: UserActions;
  groupProgress: GroupProgress;
  lineupConfig: LineupConfig;
}

function formatHeroDeadline(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
}

function withOptionalDeadline(prefix: string, deadline: Date | undefined): string {
  return deadline ? `${prefix}, or at deadline ${formatHeroDeadline(deadline)}.` : `${prefix}.`;
}

function nominationExit(cfg: LineupConfig, prog: GroupProgress): string {
  return withOptionalDeadline(
    `Auto-advances when ${cfg.nominationQuorum} of ${prog.totalVoters} have nominated`,
    cfg.nominationDeadline,
  );
}

function votingExit(cfg: LineupConfig, prog: GroupProgress): string {
  return withOptionalDeadline(
    `Auto-advances when ${cfg.votingQuorum} of ${prog.totalVoters} have voted`,
    cfg.votingDeadline,
  );
}

function schedulingExit(cfg: LineupConfig): string {
  return withOptionalDeadline(
    `Each match locks at ${cfg.schedulingAgreementPct}% agreement`,
    cfg.schedulingDeadline,
  );
}

export function getHeroState({ phase, userActions, groupProgress, lineupConfig }: HeroSelectorInput): HeroState {
  if (phase === 'nominating') {
    if (!userActions.hasSubmittedNominations) return { tone: 'action' };
    return { tone: 'waiting', exitCondition: nominationExit(lineupConfig, groupProgress), cue: "We'll DM you when voting opens." };
  }
  if (phase === 'voting') {
    if (!userActions.hasSubmittedVotes) return { tone: 'action' };
    return { tone: 'waiting', exitCondition: votingExit(lineupConfig, groupProgress), cue: "We'll DM you when matches are decided." };
  }
  if (phase === 'decided') return { tone: 'action' };
  if (phase === 'scheduling') {
    const { scheduledMatchCount, totalMatchCount } = userActions;
    if (totalMatchCount === 0 || scheduledMatchCount < totalMatchCount) return { tone: 'action' };
    return { tone: 'waiting', exitCondition: schedulingExit(lineupConfig), cue: "We'll DM you when events are locked." };
  }
  return { tone: 'set', cue: "We'll DM you 24h, 1h, and 15min before each event." };
}

/**
 * Maps the server-returned `LineupStatusDto` enum to the hero's `JourneyPhase`.
 * Note: 'decided' collapses two hero phases (decided + scheduling) — callers with
 * match-lock context should disambiguate downstream. 'archived' maps to 'done' as
 * the terminal state per brief §5.
 */
export function lineupStatusToJourneyPhase(status: LineupStatusDto): JourneyPhase {
  switch (status) {
    case 'building':
      return 'nominating';
    case 'voting':
      return 'voting';
    case 'decided':
      return 'decided';
    case 'archived':
      return 'done';
  }
}
