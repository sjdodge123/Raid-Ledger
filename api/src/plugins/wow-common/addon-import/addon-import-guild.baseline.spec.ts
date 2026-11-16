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
  ledgerlinkSeenAt: null,
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
  it('is the newest ledgerlink_seen_at, whatever the sync stamped since', () => {
    const rows = [
      row(1, { ledgerlinkSeenAt: at(0) }),
      row(2, { ledgerlinkSeenAt: at(-60) }),
      row(3, { blizzardId: 9, lastSeenAt: at(10), live: true }),
    ];
    expect(previousImportAt(rows)).toEqual(at(0));
  });

  it('is null when no import ever listed a member', () => {
    const rows = [row(1, { guid: null, blizzardId: 9, lastSeenAt: at(10) })];
    expect(previousImportAt(rows)).toBeNull();
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

  it('by GUID after a sync: the rows the last import listed plus live GUID-less rows', () => {
    const rows = [
      row(1, {
        blizzardId: 9,
        live: true,
        lastSeenAt: at(10),
        ledgerlinkSeenAt: at(0),
      }),
      row(2, { guid: null, blizzardId: 8, live: true, lastSeenAt: at(10) }),
      row(3, { lastSeenAt: at(0), ledgerlinkSeenAt: at(0) }),
      row(4, { lastSeenAt: at(-60), ledgerlinkSeenAt: at(-60) }),
      row(5, { guid: null, blizzardId: 7, lastSeenAt: at(-60) }),
    ];
    expect(ids(sourceBaseline(rows, 'guid', afterSync))).toEqual([1, 2, 3]);
  });

  it('by GUID: a paired row the sync keeps live but the last import dropped is out', () => {
    const rows = [
      row(1, { live: true, lastSeenAt: at(20), ledgerlinkSeenAt: at(20) }),
      row(2, {
        blizzardId: 9,
        live: true,
        lastSeenAt: at(20),
        ledgerlinkSeenAt: at(0),
      }),
    ];
    expect(ids(sourceBaseline(rows, 'guid', afterImport))).toEqual([1]);
  });

  it('by GUID: a member gone before the last import stays out, even when that import listed no import-only rows', () => {
    const rows = [
      row(1, {
        blizzardId: 9,
        live: true,
        lastSeenAt: at(10),
        ledgerlinkSeenAt: at(0),
      }),
      row(2, { lastSeenAt: at(-60), ledgerlinkSeenAt: at(-60) }),
    ];
    expect(ids(sourceBaseline(rows, 'guid', afterSync))).toEqual([1]);
  });
});
