/**
 * ROK-1374 — everyone's ETA on the readiness card (operator ruling
 * 2026-09-05).
 *
 * Three statuses, and the difference between them is the whole point: `eta`
 * is a shared wait, `no_speed` is "they opted in but there is nothing to
 * compute", `not_shared` is "they have not opted in" — which is a fact about
 * consent, not about their line. Confusing the last two would either invent a
 * measurement or accuse someone of hiding one.
 *
 * The privacy bar is checked here too: the row a member sees about ANOTHER
 * member carries minutes and nothing else. No Mbps, no source, no
 * measurement time (AC20).
 */
import {
  buildRosterEtas,
  type RosterEtaPerson,
} from './tie-readiness-roster-eta.helpers';

const GB = 1_000_000_000;
/** 30 GB at 100 Mbps = (30e9 * 8) / 100e6 = 2400 s = 40 min. */
const SIZE = 30 * GB;
const SHARED_AT = new Date('2026-09-05T12:00:00.000Z');

function person(over: Partial<RosterEtaPerson> = {}): RosterEtaPerson {
  return {
    userId: 1,
    displayName: 'Ana',
    mbps: 100,
    shareEtaAt: SHARED_AT,
    ...over,
  };
}

describe('buildRosterEtas', () => {
  it('gives a sharing member with a speed their wait in minutes', () => {
    const [row] = buildRosterEtas([person()], SIZE, 999);
    expect(row).toEqual({
      userId: 1,
      displayName: 'Ana',
      isViewer: false,
      status: 'eta',
      estimatedDownloadMinutes: 40,
    });
  });

  it('reports a sharing member who never measured as no_speed, not as a zero wait', () => {
    const [row] = buildRosterEtas([person({ mbps: null })], SIZE, 999);
    expect(row.status).toBe('no_speed');
    expect(row.estimatedDownloadMinutes).toBeNull();
  });

  it('reports a sharing member as no_speed when the game has no known size', () => {
    const [row] = buildRosterEtas([person()], null, 999);
    expect(row.status).toBe('no_speed');
    expect(row.estimatedDownloadMinutes).toBeNull();
  });

  it('reports a member who has not opted in as not_shared with no minutes, even though a figure exists', () => {
    const [row] = buildRosterEtas([person({ shareEtaAt: null })], SIZE, 999);
    expect(row.status).toBe('not_shared');
    expect(row.estimatedDownloadMinutes).toBeNull();
  });

  it("uses the VIEWER's own speed even when they have not opted in, and marks the line as theirs", () => {
    const [row] = buildRosterEtas(
      [person({ userId: 7, displayName: 'You', shareEtaAt: null })],
      SIZE,
      7,
    );
    expect(row).toEqual({
      userId: 7,
      displayName: 'You',
      isViewer: true,
      status: 'eta',
      estimatedDownloadMinutes: 40,
    });
  });

  it('marks the viewer as no_speed rather than not_shared when they never measured', () => {
    const [row] = buildRosterEtas(
      [person({ userId: 7, shareEtaAt: null, mbps: null })],
      SIZE,
      7,
    );
    expect(row.status).toBe('no_speed');
    expect(row.isViewer).toBe(true);
  });

  it('never emits another member Mbps, source or measurement time — minutes only (AC20)', () => {
    const rows = buildRosterEtas(
      [
        person({ userId: 1, mbps: 937.25 }),
        person({ userId: 2, displayName: 'Bo', shareEtaAt: null, mbps: 12.5 }),
      ],
      SIZE,
      999,
    );
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'displayName',
        'estimatedDownloadMinutes',
        'isViewer',
        'status',
        'userId',
      ]);
    }
    expect(JSON.stringify(rows)).not.toContain('937.25');
    expect(JSON.stringify(rows)).not.toContain('12.5');
  });

  it('keeps roster order so the card reads the same for everyone', () => {
    const rows = buildRosterEtas(
      [
        person({ userId: 3, displayName: 'Cy' }),
        person({ userId: 1, displayName: 'Ana' }),
        person({ userId: 2, displayName: 'Bo' }),
      ],
      SIZE,
      1,
    );
    expect(rows.map((r) => r.displayName)).toEqual(['Cy', 'Ana', 'Bo']);
    expect(rows.map((r) => r.isViewer)).toEqual([false, true, false]);
  });

  it('returns an empty list for an empty roster rather than inventing a row', () => {
    expect(buildRosterEtas([], SIZE, 7)).toEqual([]);
  });
});
