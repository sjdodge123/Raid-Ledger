/**
 * ROK-2124: ForeverAutoLinkService unit spec. The DB + Blizzard steps are
 * mocked at the `forever-auto-link.apply` seam (`fetchForeverProfile` is the
 * Blizzard client call); real-DB behaviour lives in the L4 integration spec.
 */
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { ForeverAutoLinkService } from './forever-auto-link.service';
import * as apply from './forever-auto-link.apply';
import type { AutoLinkCharacter } from './forever-auto-link.apply';
import type { EnrichedProfile } from '../../../characters/characters-sync.helpers';
import type { SettingsService } from '../../../settings/settings.service';

jest.mock('./forever-auto-link.apply');
const m = jest.mocked(apply);

const GAME_ID = 77;

function char(over: Partial<AutoLinkCharacter> = {}): AutoLinkCharacter {
  return {
    id: 'c-1',
    gameId: GAME_ID,
    addonGuid: 'Player-1-0001',
    gameVariant: null,
    ruleset: 'normal',
    realm: null,
    region: 'us',
    level: 20,
    name: 'Thrall',
    ...over,
  } as AutoLinkCharacter;
}

const fetched = {
  profile: { externalId: '9001' },
} as unknown as EnrichedProfile;

let settings: { get: jest.Mock; isBlizzardConfigured: jest.Mock };
let service: ForeverAutoLinkService;
const wait = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.resetAllMocks();
  wait.mockResolvedValue(undefined);
  settings = {
    get: jest.fn().mockResolvedValue(null),
    isBlizzardConfigured: jest.fn().mockResolvedValue(true),
  };
  service = new ForeverAutoLinkService(
    {} as never,
    settings as unknown as SettingsService,
    {} as never,
    wait,
  );
  m.findForeverGameId.mockResolvedValue(GAME_ID);
  m.loadAutoLinkTarget.mockResolvedValue({ row: char(), state: null });
  m.fetchForeverProfile.mockResolvedValue(fetched);
  m.findExternalIdHolder.mockResolvedValue(null);
  m.applyAutoLink.mockResolvedValue(true);
});

describe('ForeverAutoLinkService.attempt', () => {
  it('links a due candidate after a successful fetch', async () => {
    await expect(service.attempt('c-1')).resolves.toBe('linked');
    expect(m.applyAutoLink).toHaveBeenCalledWith({}, char(), fetched);
    expect(m.recordAutoLinkFailure).not.toHaveBeenCalled();
  });

  it('404 → no link, backoff failure 1 with not_found', async () => {
    m.fetchForeverProfile.mockRejectedValue(new NotFoundException('gone'));
    await expect(service.attempt('c-1')).resolves.toBe('not_found');
    expect(m.applyAutoLink).not.toHaveBeenCalled();
    expect(m.recordAutoLinkFailure).toHaveBeenCalledWith(
      {},
      'c-1',
      1,
      'not_found',
      expect.any(Date),
    );
  });

  it('counts on from the stored failures', async () => {
    const state = { failures: 3, retryAt: new Date(0) };
    m.loadAutoLinkTarget.mockResolvedValue({ row: char(), state } as never);
    m.fetchForeverProfile.mockRejectedValue(new BadGatewayException('429'));
    await expect(service.attempt('c-1')).resolves.toBe('upstream');
    expect(m.recordAutoLinkFailure).toHaveBeenCalledWith(
      {},
      'c-1',
      4,
      'upstream',
      expect.any(Date),
    );
  });

  it('skips a row still backing off (no Blizzard call)', async () => {
    const state = { failures: 1, retryAt: new Date(Date.now() + 60_000) };
    m.loadAutoLinkTarget.mockResolvedValue({ row: char(), state } as never);
    await expect(service.attempt('c-1')).resolves.toBe('skipped');
    expect(m.fetchForeverProfile).not.toHaveBeenCalled();
  });

  it('skips an already Armory-linked row', async () => {
    const row = char({ gameVariant: 'wow_forever' });
    m.loadAutoLinkTarget.mockResolvedValue({ row, state: null });
    await expect(service.attempt('c-1')).resolves.toBe('skipped');
    expect(m.fetchForeverProfile).not.toHaveBeenCalled();
    expect(m.recordAutoLinkFailure).not.toHaveBeenCalled();
  });
});

describe('ForeverAutoLinkService.attempt — gates and guards', () => {
  it('kill switch off → no call, no state write', async () => {
    settings.get.mockResolvedValue('false');
    await expect(service.attempt('c-1')).resolves.toBe('disabled');
    expect(m.loadAutoLinkTarget).not.toHaveBeenCalled();
    expect(m.fetchForeverProfile).not.toHaveBeenCalled();
    expect(m.recordAutoLinkFailure).not.toHaveBeenCalled();
  });

  it('no Blizzard credentials → no call, no state write', async () => {
    settings.isBlizzardConfigured.mockResolvedValue(false);
    await expect(service.attempt('c-1')).resolves.toBe('disabled');
    expect(m.fetchForeverProfile).not.toHaveBeenCalled();
    expect(m.recordAutoLinkFailure).not.toHaveBeenCalled();
  });

  it('externalId held by another row → not linked, conflict backoff', async () => {
    m.findExternalIdHolder.mockResolvedValue('c-other');
    await expect(service.attempt('c-1')).resolves.toBe('external_id_conflict');
    expect(m.applyAutoLink).not.toHaveBeenCalled();
    expect(m.recordAutoLinkFailure).toHaveBeenCalledWith(
      {},
      'c-1',
      1,
      'external_id_conflict',
      expect.any(Date),
    );
  });

  it('lost compare-and-set race → lost_race', async () => {
    m.applyAutoLink.mockResolvedValue(false);
    await expect(service.attempt('c-1')).resolves.toBe('lost_race');
  });
});

describe('ForeverAutoLinkService.runDue', () => {
  it('attempts every due id, spaced, and tallies the outcomes', async () => {
    m.listDueCandidateIds.mockResolvedValue(['a', 'b']);
    const tally = await service.runDue();
    expect(m.listDueCandidateIds).toHaveBeenCalledWith(
      {},
      GAME_ID,
      expect.any(Date),
      60,
    );
    expect(m.fetchForeverProfile).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(tally).toEqual({ linked: 2 });
  });

  it('a non-404 error stops the run', async () => {
    m.listDueCandidateIds.mockResolvedValue(['a', 'b', 'c']);
    m.fetchForeverProfile.mockRejectedValue(new BadGatewayException('5xx'));
    const tally = await service.runDue();
    expect(m.fetchForeverProfile).toHaveBeenCalledTimes(1);
    expect(tally).toEqual({ upstream: 1 });
  });

  it('a 404 does not stop the run', async () => {
    m.listDueCandidateIds.mockResolvedValue(['a', 'b']);
    m.fetchForeverProfile.mockRejectedValue(new NotFoundException('x'));
    await expect(service.runDue()).resolves.toEqual({ not_found: 2 });
  });

  it('kill switch off → lists nothing, calls nothing', async () => {
    settings.get.mockResolvedValue('false');
    await expect(service.runDue()).resolves.toBeNull();
    expect(m.listDueCandidateIds).not.toHaveBeenCalled();
    expect(m.fetchForeverProfile).not.toHaveBeenCalled();
  });

  it('skips an overlapping run', async () => {
    let release: (ids: string[]) => void = () => undefined;
    m.listDueCandidateIds.mockReturnValue(new Promise((r) => (release = r)));
    const first = service.runDue();
    await expect(service.runDue()).resolves.toBeNull();
    release([]);
    await expect(first).resolves.toEqual({});
  });
});
