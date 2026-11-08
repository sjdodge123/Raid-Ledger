import { Test } from '@nestjs/testing';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { SettingsService } from '../../../settings/settings.service';
import { FOREVER_ARMORY_OFF_MESSAGE } from '../forever-armory-switch';
import {
  BlizzardRosterSyncJob,
  ROSTER_SYNC_SUPERSEDED_MESSAGE,
  RUNNING_ROSTER_SYNCS,
  type ManualSyncGuild,
} from './blizzard-roster-sync.job';
import { BlizzardRosterSyncService } from './blizzard-roster-sync.service';
import { RosterArmoryService } from '../forever-armory-snapshot/roster-armory.service';

let job: BlizzardRosterSyncJob;
let sync: { syncForeverGuildRoster: jest.Mock };
let settings: { get: jest.Mock };
let armory: { runForGuild: jest.Mock };
let listSpy: jest.SpyInstance;
let readSpy: jest.SpyInstance;

/** A Forever `wow_guild` hub as `readGuild` returns it. */
function hub(slug: string | null): ManualSyncGuild {
  return {
    kind: 'wow_guild',
    gameSlug: 'world-of-warcraft-forever',
    guildSlug: slug,
    blizzardRosterSyncedAt: new Date('2026-11-06T10:00:00Z'),
  };
}

beforeEach(async () => {
  RUNNING_ROSTER_SYNCS.clear();
  sync = { syncForeverGuildRoster: jest.fn() };
  settings = { get: jest.fn().mockResolvedValue(null) };
  armory = { runForGuild: jest.fn().mockResolvedValue({}) };
  const mod = await Test.createTestingModule({
    providers: [
      BlizzardRosterSyncJob,
      { provide: DrizzleAsyncProvider, useValue: {} },
      { provide: BlizzardRosterSyncService, useValue: sync },
      { provide: SettingsService, useValue: settings },
      { provide: RosterArmoryService, useValue: armory },
    ],
  }).compile();
  job = mod.get(BlizzardRosterSyncJob);
  listSpy = jest.spyOn(job, 'listDueGuildIds').mockResolvedValue([1, 2]);
  readSpy = jest.spyOn(job, 'readGuild').mockResolvedValue(hub('ye-olde'));
});

describe('BlizzardRosterSyncJob.run (ROK-1928 C2)', () => {
  it('kill switch off → no guild list, no fetch', async () => {
    settings.get.mockResolvedValue('false');
    await job.run();
    expect(listSpy).not.toHaveBeenCalled();
    expect(sync.syncForeverGuildRoster).not.toHaveBeenCalled();
  });

  it('syncs every due guild sequentially', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue({ status: 'not_found' });
    await job.run();
    expect(sync.syncForeverGuildRoster.mock.calls).toEqual([[1], [2]]);
  });

  it('one guild throwing does not stop the next', async () => {
    sync.syncForeverGuildRoster
      .mockRejectedValueOnce(new Error('upstream 503'))
      .mockResolvedValueOnce({ status: 'skipped_empty' });
    await expect(job.run()).resolves.toEqual({
      ok: 0,
      notFound: 0,
      error: 1,
      skipped: 1,
    });
    expect(sync.syncForeverGuildRoster).toHaveBeenCalledTimes(2);
    expect(RUNNING_ROSTER_SYNCS.size).toBe(0);
  });

  it('an overlapping run is skipped', async () => {
    let release: (v: { status: 'not_found' }) => void = () => undefined;
    sync.syncForeverGuildRoster.mockImplementationOnce(
      () => new Promise((r) => (release = r)),
    );
    sync.syncForeverGuildRoster.mockResolvedValue({ status: 'not_found' });
    const first = job.run();
    await expect(job.run()).resolves.toBeNull();
    await Promise.resolve();
    release({ status: 'not_found' });
    await first;
    expect(sync.syncForeverGuildRoster).toHaveBeenCalledTimes(2);
  });

  it('skips a guild a manual sync is already running', async () => {
    RUNNING_ROSTER_SYNCS.add(1);
    sync.syncForeverGuildRoster.mockResolvedValue({
      status: 'ok',
      updated: 1,
      inserted: 0,
    });
    const tally = await job.run();
    expect(sync.syncForeverGuildRoster.mock.calls).toEqual([[2]]);
    expect(tally).toEqual({ ok: 1, notFound: 0, error: 0, skipped: 1 });
  });
});

describe('BlizzardRosterSyncJob.syncNow (ROK-1928 C3)', () => {
  it('403 with the kill-switch copy when off', async () => {
    settings.get.mockResolvedValue('false');
    await expect(job.syncNow(7)).rejects.toThrow(
      new ForbiddenException(FOREVER_ARMORY_OFF_MESSAGE),
    );
  });

  it('404 when the guild has no slug', async () => {
    readSpy.mockResolvedValue(hub(null));
    await expect(job.syncNow(7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 while that guild is already syncing', async () => {
    RUNNING_ROSTER_SYNCS.add(7);
    await expect(job.syncNow(7)).rejects.toBeInstanceOf(ConflictException);
    expect(sync.syncForeverGuildRoster).not.toHaveBeenCalled();
  });

  it('502 when the service rethrows, and frees the guild', async () => {
    sync.syncForeverGuildRoster.mockRejectedValue(new Error('503'));
    await expect(job.syncNow(7)).rejects.toBeInstanceOf(BadGatewayException);
    expect(RUNNING_ROSTER_SYNCS.has(7)).toBe(false);
  });

  it('200 summary: status, syncedAt, members applied', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue({
      status: 'ok',
      updated: 4,
      inserted: 1,
    });
    await expect(job.syncNow(7)).resolves.toEqual({
      status: 'ok',
      syncedAt: '2026-11-06T10:00:00.000Z',
      members: 5,
    });
  });

  it('200 stale: a newer snapshot is stored → status stale, members 0', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue({ status: 'stale' });
    await expect(job.syncNow(7)).resolves.toEqual({
      status: 'stale',
      syncedAt: '2026-11-06T10:00:00.000Z',
      members: 0,
    });
  });
});

describe('BlizzardRosterSyncJob — superseded outcome (ROK-1928 review R3)', () => {
  it('manual run: 409 with the run-again copy when the slug changed mid-fetch', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue({ status: 'superseded' });
    await expect(job.syncNow(7)).rejects.toThrow(
      new ConflictException(ROSTER_SYNC_SUPERSEDED_MESSAGE),
    );
    expect(RUNNING_ROSTER_SYNCS.has(7)).toBe(false);
  });

  it('cron: counts a superseded guild under skipped', async () => {
    sync.syncForeverGuildRoster
      .mockResolvedValueOnce({ status: 'superseded' })
      .mockResolvedValueOnce({ status: 'ok', updated: 1, inserted: 0 });
    const tally = await job.run();
    expect(tally).toEqual({ ok: 1, notFound: 0, error: 0, skipped: 1 });
  });
});

describe('BlizzardRosterSyncJob.run — stale outcome (ROK-1928 MINOR 15)', () => {
  it('counts a stale guild under skipped', async () => {
    sync.syncForeverGuildRoster
      .mockResolvedValueOnce({ status: 'stale' })
      .mockResolvedValueOnce({ status: 'ok', updated: 1, inserted: 0 });
    const tally = await job.run();
    expect(tally).toEqual({ ok: 1, notFound: 0, error: 0, skipped: 1 });
  });
});

describe('BlizzardRosterSyncJob.syncNow — roster Armory pass (ROK-2133 AC-13)', () => {
  const ok = { status: 'ok', updated: 1, inserted: 0 };

  afterEach(() => jest.useRealTimers());

  it('fires one pass for that guild without waiting for it', async () => {
    // Fake timers: no wall-clock wait. If syncNow awaited the never-settling
    // pass, the 'blocked' timer would win the race once it is advanced.
    jest.useFakeTimers();
    sync.syncForeverGuildRoster.mockResolvedValue(ok);
    armory.runForGuild.mockReturnValue(new Promise(() => undefined));
    const blocked = new Promise<string>((r) =>
      setTimeout(() => r('blocked'), 200),
    );
    const race = Promise.race([
      job.syncNow(7).then(() => 'responded'),
      blocked,
    ]);
    await jest.advanceTimersByTimeAsync(200);
    const outcome = await race;
    expect(outcome).toBe('responded');
    expect(armory.runForGuild).toHaveBeenCalledTimes(1);
    expect(armory.runForGuild).toHaveBeenCalledWith(7);
  });

  it('a failing pass never fails the Sync now response', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue(ok);
    armory.runForGuild.mockRejectedValue(new Error('boom'));
    await expect(job.syncNow(7)).resolves.toMatchObject({ status: 'ok' });
    await new Promise((r) => setImmediate(r));
    expect(armory.runForGuild).toHaveBeenCalledWith(7);
  });

  it('no pass when the roster sync did not succeed', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue({ status: 'stale' });
    await job.syncNow(7);
    expect(armory.runForGuild).not.toHaveBeenCalled();
  });

  it('the cron roster run does not fire passes (the hourly job covers them)', async () => {
    sync.syncForeverGuildRoster.mockResolvedValue(ok);
    await job.run();
    expect(armory.runForGuild).not.toHaveBeenCalled();
  });
});
