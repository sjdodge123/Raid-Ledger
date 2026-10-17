/**
 * Tests for getPhaseState (ROK-1209).
 *
 * Pure function. Determines which "envelope" hero copy to use:
 *   aborted > phase-complete > deadline-missed > deadline-soon > plenty-of-time.
 */
import { describe, expect, it } from 'vitest';
import { getPhaseState, type PhaseState } from './lineup-phase-state';
import { createMockLineupDetail } from '../test/lineup-factories';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-05-01T12:00:00Z').getTime();

describe('getPhaseState — branches', () => {
  it("returns 'aborted' when abortedAt is set, regardless of other conditions", () => {
    const lineup = createMockLineupDetail({
      status: 'archived',
      phaseDeadline: new Date(NOW - HOUR).toISOString(),
    });
    expect(
      getPhaseState(lineup, '2026-04-28T15:00:00Z', NOW),
    ).toBe<PhaseState>('aborted');
  });

  it("returns 'phase-complete' when status is 'archived' and not aborted", () => {
    const lineup = createMockLineupDetail({ status: 'archived' });
    expect(getPhaseState(lineup, null, NOW)).toBe<PhaseState>('phase-complete');
  });

  it("returns 'deadline-missed' when phaseDeadline is in the past", () => {
    const lineup = createMockLineupDetail({
      status: 'building',
      phaseDeadline: new Date(NOW - HOUR).toISOString(),
    });
    expect(getPhaseState(lineup, null, NOW)).toBe<PhaseState>('deadline-missed');
  });

  it("returns 'deadline-soon' when phaseDeadline is within 24h", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      phaseDeadline: new Date(NOW + 6 * HOUR).toISOString(),
    });
    expect(getPhaseState(lineup, null, NOW)).toBe<PhaseState>('deadline-soon');
  });

  it("returns 'plenty-of-time' when phaseDeadline is more than 24h out", () => {
    const lineup = createMockLineupDetail({
      status: 'building',
      phaseDeadline: new Date(NOW + 48 * HOUR).toISOString(),
    });
    expect(getPhaseState(lineup, null, NOW)).toBe<PhaseState>('plenty-of-time');
  });

  it("returns 'plenty-of-time' when phaseDeadline is null and status is active", () => {
    const lineup = createMockLineupDetail({
      status: 'building',
      phaseDeadline: null,
    });
    expect(getPhaseState(lineup, null, NOW)).toBe<PhaseState>('plenty-of-time');
  });
});

describe('getPhaseState — precedence (aborted wins)', () => {
  it("aborted beats phase-complete (archived AND aborted)", () => {
    const lineup = createMockLineupDetail({ status: 'archived' });
    expect(getPhaseState(lineup, '2026-04-28T15:00:00Z', NOW)).toBe<PhaseState>(
      'aborted',
    );
  });

  it("aborted beats deadline-missed (active phase past deadline AND aborted)", () => {
    const lineup = createMockLineupDetail({
      status: 'voting',
      phaseDeadline: new Date(NOW - HOUR).toISOString(),
    });
    expect(getPhaseState(lineup, '2026-04-28T15:00:00Z', NOW)).toBe<PhaseState>(
      'aborted',
    );
  });
});
