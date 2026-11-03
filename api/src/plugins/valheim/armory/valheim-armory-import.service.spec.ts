/**
 * ROK-1835 L2 — importer status transitions with a mocked repository:
 * imported, skipped_stale, invalid → failed (no armory write), waiting_blob,
 * internal error → failed `internal:<name>`, replaced mid-read → busy.
 */
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import type { ValheimArmoryRepository } from './valheim-armory.repository';
import {
  ValheimArmoryImportService,
  characterDetail,
} from './valheim-armory-import.service';
import type { ValheimDeathsRepository } from './valheim-deaths.repository';
import type { ValheimSkillDaysRepository } from './valheim-skill-days.repository';
import type { SettingsService } from '../../../settings/settings.service';

const CAND = { id: 5, receivedAt: '2026-10-17 20:16:00.123456+00' };
const tx = { tx: true };

function snap(name: string, payload?: unknown): ArmorySnapshot {
  const msg = loadValheimFixture(name);
  const row = valheimSnapshotRow(3, msg as never);
  return {
    id: CAND.id,
    pelicanServerId: 3,
    kind: row.kind,
    steamId: row.steamId ?? null,
    playerId: row.playerId ?? null,
    worldUid: row.worldUid ?? null,
    receivedAt: CAND.receivedAt,
    payload: payload ?? msg,
  };
}

function setup(locked: ArmorySnapshot | null) {
  const repo = {
    db: { transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)) },
    listCandidates: jest.fn().mockResolvedValue([CAND]),
    lockSnapshot: jest.fn().mockResolvedValue(locked),
    markStatus: jest.fn().mockResolvedValue(true),
    upsertProfile: jest.fn().mockResolvedValue({ id: 9 }),
    backfillMapProfile: jest.fn().mockResolvedValue(undefined),
    findProfileId: jest.fn().mockResolvedValue(null),
    upsertMap: jest.fn().mockResolvedValue(true),
    upsertCatalog: jest.fn().mockResolvedValue(true),
    blobExists: jest.fn().mockResolvedValue(true),
  };
  const hook = { onProfileUpserted: jest.fn().mockResolvedValue(undefined) };
  const skillDays = {
    findPriorSkills: jest.fn().mockResolvedValue(null),
    recordDay: jest.fn().mockResolvedValue('2026-10-17'),
  };
  const settings = {
    getDefaultTimezone: jest.fn().mockResolvedValue('America/New_York'),
  };
  const deaths = {
    recordReportedDeaths: jest
      .fn()
      .mockResolvedValue({ inserted: 0, foreign: 0 }),
  };
  const svc = new ValheimArmoryImportService(
    repo as unknown as ValheimArmoryRepository,
    hook,
    skillDays as unknown as ValheimSkillDaysRepository,
    settings as unknown as SettingsService,
    deaths as unknown as ValheimDeathsRepository,
  );
  return { repo, hook, skillDays, settings, deaths, svc };
}

describe('ValheimArmoryImportService', () => {
  it('imports a character, back-fills maps and calls the L3 hook in-tx', async () => {
    const { repo, hook, svc } = setup(snap('character-vanilla'));
    const summary = await svc.drainOnce();
    expect(summary.imported).toBe(1);
    expect(hook.onProfileUpserted).toHaveBeenCalledWith(tx, { id: 9 });
    expect(repo.backfillMapProfile).toHaveBeenCalledWith(tx, { id: 9 });
    expect(repo.markStatus).toHaveBeenCalledWith(tx, CAND, 'imported', null);
  });

  it('records the play day from the prior skills and the drain default tz (ROK-1882)', async () => {
    const { skillDays, settings, svc } = setup(snap('character-vanilla'));
    const prior = [{ id: 'Swords', level: 10, accumulator: 0 }];
    skillDays.findPriorSkills.mockResolvedValue(prior);
    await svc.drainOnce();
    expect(settings.getDefaultTimezone).toHaveBeenCalledTimes(1);
    expect(skillDays.findPriorSkills).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ pelicanServerId: 3 }),
    );
    expect(skillDays.recordDay).toHaveBeenCalledWith(
      tx,
      { id: 9 },
      prior,
      'America/New_York',
    );
  });

  it('marks an older snapshot skipped_stale and skips the hook', async () => {
    const { repo, hook, skillDays, deaths, svc } = setup(
      snap('character-eaqs'),
    );
    repo.upsertProfile.mockResolvedValue(null);
    expect(await svc.importOne(CAND)).toBe('skipped_stale');
    expect(hook.onProfileUpserted).not.toHaveBeenCalled();
    expect(skillDays.recordDay).not.toHaveBeenCalled();
    expect(deaths.recordReportedDeaths).not.toHaveBeenCalled();
    expect(repo.markStatus).toHaveBeenCalledWith(
      tx,
      CAND,
      'skipped_stale',
      null,
    );
  });

  it('fails an invalid payload without touching armory rows', async () => {
    const { repo, svc } = setup(snap('items-atlas', { kind: 'items' }));
    expect(await svc.importOne(CAND)).toBe('failed');
    expect(repo.upsertCatalog).not.toHaveBeenCalled();
    const detail: unknown = repo.markStatus.mock.calls[0]?.[3];
    expect(detail).toEqual(expect.stringMatching(/^invalid:/));
  });

  it('stores a map whose base map is missing and marks it waiting_blob', async () => {
    const { repo, svc } = setup(snap('map-shared-layer'));
    repo.blobExists.mockResolvedValue(false);
    expect(await svc.importOne(CAND)).toBe('waiting_blob');
    expect(repo.upsertMap).toHaveBeenCalled();
    expect(repo.markStatus).toHaveBeenCalledWith(
      tx,
      CAND,
      'waiting_blob',
      'blob:baseMap',
    );
  });

  it('imports a map without a base map without a blob lookup', async () => {
    const { repo, svc } = setup(snap('map-personal'));
    expect(await svc.importOne(CAND)).toBe('imported');
    expect(repo.blobExists).not.toHaveBeenCalled();
  });

  it('marks an unexpected error failed internal:<name> outside the tx', async () => {
    const { repo, svc } = setup(snap('items-file-icons'));
    repo.upsertCatalog.mockRejectedValue(new TypeError('boom'));
    expect(await svc.importOne(CAND)).toBe('failed');
    expect(repo.markStatus).toHaveBeenCalledWith(
      repo.db,
      CAND,
      'failed',
      'internal:TypeError',
    );
  });

  it('reports busy when the row is locked or replaced', async () => {
    const { repo, svc } = setup(null);
    expect(await svc.importOne(CAND)).toBe('busy');
    expect(repo.markStatus).not.toHaveBeenCalled();
  });
});

describe('ValheimArmoryImportService reported deaths (ROK-1931)', () => {
  it('stores the reported deaths on the upserted profile in-tx and counts foreign ones (ROK-1931)', async () => {
    const msg = loadValheimFixture('character-deaths');
    const { repo, deaths, svc } = setup(snap('character-deaths'));
    deaths.recordReportedDeaths.mockResolvedValue({ inserted: 2, foreign: 1 });
    expect(await svc.importOne(CAND)).toBe('imported');
    expect(deaths.recordReportedDeaths).toHaveBeenCalledWith(
      tx,
      { id: 9 },
      msg.deaths,
    );
    expect(repo.markStatus).toHaveBeenCalledWith(
      tx,
      CAND,
      'imported',
      'deaths_foreign:1',
    );
  });

  it('passes an empty death list for a snapshot without deaths (ROK-1931)', async () => {
    const { deaths, svc } = setup(snap('character-vanilla'));
    await svc.drainOnce();
    expect(deaths.recordReportedDeaths).toHaveBeenCalledWith(tx, { id: 9 }, []);
  });
});

describe('characterDetail (ROK-1931)', () => {
  it('is null when nothing was truncated or ignored', () => {
    expect(characterDetail([], 0)).toBeNull();
  });

  it('names truncated lists and ignored foreign deaths together', () => {
    expect(characterDetail(['knownItems'], 0)).toBe('truncated:knownItems');
    expect(characterDetail([], 2)).toBe('deaths_foreign:2');
    expect(characterDetail(['knownItems', 'knownRecipes'], 3)).toBe(
      'truncated:knownItems,knownRecipes;deaths_foreign:3',
    );
  });
});
