/**
 * Failing-first tests for getHeroState selector + lineupStatusToJourneyPhase mapper (ROK-1294).
 * Source files do not yet exist — these MUST fail with module-not-found until dev implements.
 */
import { describe, it, expect } from 'vitest';
import { getHeroState, lineupStatusToJourneyPhase } from './get-hero-state';
import type { GroupProgress, LineupConfig, UserActions } from './types';

const noNoms: UserActions = { hasSubmittedNominations: false, hasSubmittedVotes: false, scheduledMatchCount: 0, totalMatchCount: 0 };
const submittedNoms: UserActions = { hasSubmittedNominations: true, hasSubmittedVotes: false, scheduledMatchCount: 0, totalMatchCount: 0 };
const submittedVotes: UserActions = { hasSubmittedNominations: true, hasSubmittedVotes: true, scheduledMatchCount: 0, totalMatchCount: 0 };
const partialSchedule: UserActions = { hasSubmittedNominations: true, hasSubmittedVotes: true, scheduledMatchCount: 1, totalMatchCount: 2 };
const fullSchedule: UserActions = { hasSubmittedNominations: true, hasSubmittedVotes: true, scheduledMatchCount: 2, totalMatchCount: 2 };

const progress: GroupProgress = { nominationsSubmitted: 3, votesSubmitted: 0, totalVoters: 20 };

const deadline = new Date('2026-05-20T23:59:00Z');
const cfgWithDeadlines: LineupConfig = {
    nominationQuorum: 15,
    votingQuorum: 15,
    schedulingAgreementPct: 75,
    nominationDeadline: deadline,
    votingDeadline: deadline,
    schedulingDeadline: deadline,
};
const cfgNoDeadlines: LineupConfig = {
    nominationQuorum: 15,
    votingQuorum: 15,
    schedulingAgreementPct: 75,
};

describe('getHeroState — decision table (8 rows)', () => {
    it('row 1: nominating + NOT submitted → action', () => {
        const state = getHeroState({ phase: 'nominating', userActions: noNoms, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state).toEqual({ tone: 'action' });
    });

    it('row 2: nominating + submitted → waiting with exitCondition + cue', () => {
        const state = getHeroState({ phase: 'nominating', userActions: submittedNoms, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state.tone).toBe('waiting');
        expect(state.exitCondition).toMatch(/Auto-advances when 15 of 20 have nominated/);
        expect(state.exitCondition).toMatch(/or at deadline /);
        expect(state.cue).toBe("We'll DM you when voting opens.");
    });

    it('row 3: voting + NOT submitted → action', () => {
        const state = getHeroState({ phase: 'voting', userActions: submittedNoms, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state).toEqual({ tone: 'action' });
    });

    it('row 4: voting + submitted → waiting with exitCondition + cue', () => {
        const state = getHeroState({ phase: 'voting', userActions: submittedVotes, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state.tone).toBe('waiting');
        expect(state.exitCondition).toMatch(/Auto-advances when 15 of 20 have voted/);
        expect(state.exitCondition).toMatch(/or at deadline /);
        expect(state.cue).toBe("We'll DM you when matches are decided.");
    });

    it('row 5: decided → action (always)', () => {
        const state = getHeroState({ phase: 'decided', userActions: submittedVotes, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state).toEqual({ tone: 'action' });
    });

    it('row 6: scheduling + scheduledMatchCount < totalMatchCount → action', () => {
        const state = getHeroState({ phase: 'scheduling', userActions: partialSchedule, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state).toEqual({ tone: 'action' });
    });

    it('row 7: scheduling + scheduledMatchCount === totalMatchCount (>0) → waiting', () => {
        const state = getHeroState({ phase: 'scheduling', userActions: fullSchedule, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state.tone).toBe('waiting');
        expect(state.exitCondition).toMatch(/Each match locks at 75% agreement/);
        expect(state.exitCondition).toMatch(/or at deadline /);
        expect(state.cue).toBe("We'll DM you when events are locked.");
    });

    it('row 8: done → set with cue, no exitCondition', () => {
        const state = getHeroState({ phase: 'done', userActions: fullSchedule, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state.tone).toBe('set');
        expect(state.exitCondition).toBeUndefined();
        expect(state.cue).toBe("We'll DM you 24h, 1h, and 15min before each event.");
    });
});

describe('getHeroState — missing deadline cleanup', () => {
    it('nominating + submitted + no deadline → exitCondition omits "or at deadline" clause cleanly', () => {
        const state = getHeroState({ phase: 'nominating', userActions: submittedNoms, groupProgress: progress, lineupConfig: cfgNoDeadlines });
        expect(state.tone).toBe('waiting');
        expect(state.exitCondition).toBeDefined();
        expect(state.exitCondition).not.toMatch(/or at deadline/);
        expect(state.exitCondition).not.toMatch(/undefined/);
        expect(state.exitCondition).not.toMatch(/,\s*\.?$/); // no dangling trailing comma
        expect(state.exitCondition).toMatch(/\.$/); // ends with a period cleanly
    });

    it('voting + submitted + no deadline → exitCondition omits "or at deadline" cleanly', () => {
        const state = getHeroState({ phase: 'voting', userActions: submittedVotes, groupProgress: progress, lineupConfig: cfgNoDeadlines });
        expect(state.tone).toBe('waiting');
        expect(state.exitCondition).toBeDefined();
        expect(state.exitCondition).not.toMatch(/or at deadline/);
        expect(state.exitCondition).not.toMatch(/undefined/);
        expect(state.exitCondition).not.toMatch(/,\s*\.?$/);
        expect(state.exitCondition).toMatch(/\.$/);
    });

    it('scheduling + fully scheduled + no deadline → exitCondition omits "or at deadline" cleanly', () => {
        const state = getHeroState({ phase: 'scheduling', userActions: fullSchedule, groupProgress: progress, lineupConfig: cfgNoDeadlines });
        expect(state.tone).toBe('waiting');
        expect(state.exitCondition).toBeDefined();
        expect(state.exitCondition).not.toMatch(/or at deadline/);
        expect(state.exitCondition).not.toMatch(/undefined/);
        expect(state.exitCondition).not.toMatch(/,\s*\.?$/);
        expect(state.exitCondition).toMatch(/\.$/);
    });
});

describe('getHeroState — edge cases', () => {
    it('scheduling + totalMatchCount === 0 → action (degenerate "all scheduled of zero")', () => {
        const zero: UserActions = { hasSubmittedNominations: true, hasSubmittedVotes: true, scheduledMatchCount: 0, totalMatchCount: 0 };
        const state = getHeroState({ phase: 'scheduling', userActions: zero, groupProgress: progress, lineupConfig: cfgWithDeadlines });
        expect(state.tone).toBe('action');
    });

    it('determinism: same input invoked twice returns deeply equal output', () => {
        const input = { phase: 'nominating' as const, userActions: submittedNoms, groupProgress: progress, lineupConfig: cfgWithDeadlines };
        const a = getHeroState(input);
        const b = getHeroState(input);
        expect(a).toEqual(b);
    });
});

// lineupStatusToJourneyPhase mapper — inputs are LineupStatusDto: 'building' | 'voting' | 'decided' | 'archived'.
// Architect's note (architect-ROK-1294.md §3): 'building' → 'nominating', 'voting' → 'voting'.
// 'decided' collapses two hero phases — caller passes a second arg to disambiguate (matches unlocked = scheduling).
// 'archived' → 'done' only when the caller signals completion; otherwise mapper falls back to 'nominating' per brief §5.
describe('lineupStatusToJourneyPhase mapper', () => {
    it("maps 'building' → 'nominating'", () => {
        expect(lineupStatusToJourneyPhase('building')).toBe('nominating');
    });

    it("maps 'voting' → 'voting'", () => {
        expect(lineupStatusToJourneyPhase('voting')).toBe('voting');
    });

    it("maps 'decided' → 'decided' by default", () => {
        expect(lineupStatusToJourneyPhase('decided')).toBe('decided');
    });

    it("maps 'archived' → 'done' (terminal state)", () => {
        expect(lineupStatusToJourneyPhase('archived')).toBe('done');
    });
});
