/**
 * ROK-2225 — the pure halves of a roster source's baseline. The DB replay is
 * `guilds/blizzard-roster-sync.cross-source.integration.spec.ts`.
 */
import {
  blizzardCanSee,
  ledgerLinkCanSee,
  previousImportAt,
  sourceBaseline,
  type RosterClock,
  type StoredRosterRow,
} from './addon-import-guild.baseline';

const at = (min: number): Date => new Date(Date.UTC(2026, 10, 16, 0, min));

const row = (
  id: number,
  over: Partial<StoredRosterRow> = {},
): StoredRosterRow => ({
  id,
  guid: `g${id}`,
  blizzardId: null,
  name: `M${id}`,
  grantId: null,
  live: false,
  lastSeenAt: null,
  ...over,
});

/** Import at :00, Blizzard sync at :10 (the latest snapshot). */
const afterSync: RosterClock = {
  lastSnapshotAt: at(10),
  blizzardSyncedAt: at(10),
};
/** Blizzard sync at :10, import at :20 (the latest snapshot). */
const afterImport: RosterClock = {
  lastSnapshotAt: at(20),
  blizzardSyncedAt: at(10),
};

const ids = (rows: readonly StoredRosterRow[]) => rows.map((r) => r.id);

describe('who can see a row', () => {
  it.each([
    ['paired (GUID + Blizzard id)', { blizzardId: 9 }, true, true],
    ['LedgerLink-only (GUID, no Blizzard id)', {}, false, true],
    ['Blizzard-only (no GUID)', { guid: null, blizzardId: 9 }, true, false],
  ])('%s', (_label, over, blizzard, ledgerLink) => {
    expect(blizzardCanSee(row(1, over))).toBe(blizzard);
    expect(ledgerLinkCanSee(row(1, over))).toBe(ledgerLink);
  });
});

describe('previousImportAt', () => {
  it('is the newest import-only row older than the latest sync', () => {
    const rows = [
      row(1, { lastSeenAt: at(0) }),
      row(2, { lastSeenAt: at(-60) }),
      row(3, { blizzardId: 9, lastSeenAt: at(10), live: true }),
    ];
    expect(previousImportAt(rows, afterSync)).toEqual(at(0));
  });

  it('is null when the latest snapshot is an import, or there was never a sync', () => {
    const rows = [row(1, { lastSeenAt: at(0) })];
    expect(previousImportAt(rows, afterImport)).toBeNull();
    const never = { lastSnapshotAt: at(0), blizzardSyncedAt: null };
    expect(previousImportAt(rows, never)).toBeNull();
  });
});

describe('sourceBaseline', () => {
  it('by id after an import: live rows plus the rows the last sync stamped', () => {
    const rows = [
      row(1, { blizzardId: 9, live: true, lastSeenAt: at(20) }),
      row(2, { live: true, lastSeenAt: at(20) }),
      row(3, { guid: null, blizzardId: 8, lastSeenAt: at(10) }),
      row(4, { guid: null, blizzardId: 7, lastSeenAt: at(-60) }),
    ];
    expect(ids(sourceBaseline(rows, 'id', afterImport))).toEqual([1, 2, 3]);
  });

  it('by GUID after a sync: live rows plus the import-only rows the last import listed', () => {
    const rows = [
      row(1, { blizzardId: 9, live: true, lastSeenAt: at(10) }),
      row(2, { guid: null, blizzardId: 8, live: true, lastSeenAt: at(10) }),
      row(3, { lastSeenAt: at(0) }),
      row(4, { lastSeenAt: at(-60) }),
    ];
    expect(ids(sourceBaseline(rows, 'guid', afterSync))).toEqual([1, 2, 3]);
  });

  it('by GUID after an import: just the live rows', () => {
    const rows = [
      row(1, { live: true, lastSeenAt: at(20) }),
      row(2, { lastSeenAt: at(0) }),
    ];
    expect(ids(sourceBaseline(rows, 'guid', afterImport))).toEqual([1]);
  });
});
