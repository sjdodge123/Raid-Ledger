/**
 * #1949 review NIT 22 — a manual Create and the cron in the same second get
 * different dump names; the names keep the shape listing/rotation parse.
 */
import * as path from 'node:path';

import { DailyDumpNamer, dailyDumpName } from './backup-daily-dump.helpers';
import { formatBackupTimestamp } from './backup.helpers';
import { uploadsArchiveName } from './backup-uploads.helpers';

const DIR = '/backups/daily';
const AT = new Date(2026, 10, 5, 2, 0, 10);
const STAMP = formatBackupTimestamp(AT);
const none = (): boolean => false;

describe('DailyDumpNamer', () => {
  it('two dumps started in the same second get different names', () => {
    const namer = new DailyDumpNamer();
    const first = namer.next(DIR, AT, none);
    const second = namer.next(DIR, AT, none);
    expect(first).toBe(`raid_ledger_${STAMP}.dump`);
    expect(second).toBe(`raid_ledger_${STAMP}_2.dump`);
  });

  it('a new second starts again at the plain name', () => {
    const namer = new DailyDumpNamer();
    namer.next(DIR, AT, none);
    expect(namer.next(DIR, new Date(AT.getTime() + 1000), none)).toBe(
      `raid_ledger_${formatBackupTimestamp(new Date(AT.getTime() + 1000))}.dump`,
    );
  });

  it('skips a name already on disk — as a dump or as its uploads archive', () => {
    const onDisk = new Set([
      path.join(DIR, dailyDumpName(STAMP, 1)),
      path.join(DIR, uploadsArchiveName(dailyDumpName(STAMP, 2))),
    ]);
    const name = new DailyDumpNamer().next(DIR, AT, (p) => onDisk.has(p));
    expect(name).toBe(`raid_ledger_${STAMP}_3.dump`);
  });

  it('keeps the raid_ledger_*.dump shape and its companion archive name', () => {
    const name = dailyDumpName(STAMP, 2);
    expect(name).toMatch(/^raid_ledger_\d{4}-\d{2}-\d{2}_\d{6}_2\.dump$/);
    expect(uploadsArchiveName(name)).toBe(`raid_ledger_${STAMP}_2.uploads.tar`);
    // Equal-mtime rotation tie-break: the suffixed (later) name sorts newer.
    expect(name > dailyDumpName(STAMP, 1)).toBe(true);
  });

  it('gives up probing at a bound instead of looping forever', () => {
    const name = new DailyDumpNamer().next(DIR, AT, () => true);
    expect(name).toMatch(/_50\.dump$/);
  });
});
