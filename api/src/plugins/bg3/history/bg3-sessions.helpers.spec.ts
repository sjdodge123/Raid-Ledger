/** ROK-1957 §9.1 U-1 — read-time session clustering (D-8). */
import { BG3_SESSION_GAP_MS } from '../bg3.constants';
import { clusterSessions, type Bg3SessionRow } from './bg3-sessions.helpers';

const T0 = Date.parse('2026-01-01T10:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

function row(
  id: number,
  offsetMs: number,
  extra: Partial<Bg3SessionRow> = {},
): Bg3SessionRow {
  return {
    id,
    savedAt: new Date(T0 + offsetMs),
    currentLevel: 'WLD_Main_A',
    partyMaxLevel: id,
    ...extra,
  };
}

describe('clusterSessions', () => {
  it('keeps saves less than 4 h apart in one session (t, t+3h59m, t+7h58m)', () => {
    const rows = [
      row(1, 0),
      row(2, 4 * HOUR - MIN),
      row(3, 8 * HOUR - 2 * MIN),
    ];
    const sessions = clusterSessions(rows, BG3_SESSION_GAP_MS);
    expect(sessions.map((s) => s.rowIds)).toEqual([[1, 2, 3]]);
    expect(sessions[0]?.saveCount).toBe(3);
  });

  it('starts a new session at exactly a 4 h gap', () => {
    const sessions = clusterSessions([row(1, 0), row(2, 4 * HOUR)]);
    expect(sessions.map((s) => s.rowIds)).toEqual([[1], [2]]);
  });

  it('sorts by savedAt then id, and reports bounds, levels, areas and last save', () => {
    const rows = [
      row(3, 2 * HOUR, { currentLevel: 'SCL_Main_A' }),
      row(1, 0),
      row(2, HOUR, { currentLevel: 'WLD_Main_A' }),
    ];
    const [s] = clusterSessions(rows);
    expect(s).toEqual({
      startedAt: new Date(T0),
      endedAt: new Date(T0 + 2 * HOUR),
      saveCount: 3,
      partyLevelFrom: 1,
      partyLevelTo: 3,
      areas: ['WLD_Main_A', 'SCL_Main_A'],
      lastSaveId: 3,
      rowIds: [1, 2, 3],
    });
  });

  it('takes startedAt and saveCount from a collapsed row’s stamps', () => {
    const collapsed = row(9, 10 * HOUR, {
      sessionFirstSavedAt: new Date(T0 + 7 * HOUR),
      sessionSaveCount: 5,
    });
    const sessions = clusterSessions([row(1, 0), collapsed]);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toMatchObject({
      startedAt: new Date(T0 + 7 * HOUR),
      endedAt: new Date(T0 + 10 * HOUR),
      saveCount: 5,
      lastSaveId: 9,
    });
  });

  it('measures the gap to a collapsed row from its first save, not its last', () => {
    const collapsed = row(9, 6 * HOUR, {
      sessionFirstSavedAt: new Date(T0 + 4 * HOUR + MIN),
      sessionSaveCount: 2,
    });
    const sessions = clusterSessions([row(1, 0), collapsed]);
    expect(sessions.map((s) => s.rowIds)).toEqual([[1], [9]]);
  });

  it('returns no sessions for no rows', () => {
    expect(clusterSessions([])).toEqual([]);
  });
});
