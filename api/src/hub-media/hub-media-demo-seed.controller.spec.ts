/**
 * ROK-1959 — the DEMO hub-media seed: the Discord default is unchanged, and
 * `source: 'bg3-save'` stores game-save pictures owned by `uploadedBy`
 * through `ingestFromSource` (never the Discord `ingest`).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { findHiddenAt } from '../guilds/hub-hidden.helpers';
import { HubMediaDemoSeedController } from './hub-media-demo-seed.controller';
import {
  findSeedUploader,
  parseDemoSeedBody,
} from './hub-media-demo-seed.helpers';
import { HubMediaService } from './hub-media.service';
import type { HubMediaSourceInput } from './hub-media.types';

jest.mock('../guilds/hub-hidden.helpers', () => ({ findHiddenAt: jest.fn() }));
jest.mock('./hub-media-demo-seed.helpers', () => ({
  ...jest.requireActual<object>('./hub-media-demo-seed.helpers'),
  findSeedUploader: jest.fn(),
}));

const hiddenAt = jest.mocked(findHiddenAt);
const uploader = jest.mocked(findSeedUploader);
const db = {} as PostgresJsDatabase<typeof schema>;

describe('parseDemoSeedBody', () => {
  it('defaults to the Discord seed of 14', () => {
    expect(parseDemoSeedBody({ guildId: 5 })).toEqual({
      source: 'discord',
      guildId: 5,
      count: 14,
    });
  });

  it('keeps the Discord floor of 3 and refuses an uploader on a Discord seed', () => {
    expect(parseDemoSeedBody({ guildId: 5, count: 2 })).toBeNull();
    expect(parseDemoSeedBody({ guildId: 5, uploadedBy: 9 })).toBeNull();
  });

  it('a bg3-save seed needs uploadedBy and defaults to 2 pictures', () => {
    expect(parseDemoSeedBody({ guildId: 5, source: 'bg3-save' })).toBeNull();
    expect(
      parseDemoSeedBody({ guildId: 5, source: 'bg3-save', uploadedBy: 9 }),
    ).toEqual({ source: 'bg3-save', guildId: 5, count: 2, uploadedBy: 9 });
  });

  it('refuses an unknown source or key', () => {
    expect(parseDemoSeedBody({ guildId: 5, source: 'upload' })).toBeNull();
    expect(parseDemoSeedBody({ guildId: 5, extra: true })).toBeNull();
  });
});

describe('HubMediaDemoSeedController.seed', () => {
  let fromSource: jest.SpyInstance;
  let discordIngest: jest.SpyInstance;

  beforeEach(() => {
    hiddenAt.mockResolvedValue(null);
    uploader.mockResolvedValue({ id: 9, name: 'Shadowheart' });
    let next = 100;
    fromSource = jest
      .spyOn(HubMediaService.prototype, 'ingestFromSource')
      .mockImplementation(() =>
        Promise.resolve({ status: 'stored', mediaId: (next += 1) }),
      );
    discordIngest = jest.spyOn(HubMediaService.prototype, 'ingest');
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores save pictures owned by the uploader through ingestFromSource', async () => {
    const res = await new HubMediaDemoSeedController(db).seed({
      guildId: 5,
      source: 'bg3-save',
      uploadedBy: 9,
    });
    expect(res).toEqual({ guildId: 5, ids: [101, 102] });
    expect(discordIngest).not.toHaveBeenCalled();
    const inputs = fromSource.mock.calls.map(
      ([input]: [HubMediaSourceInput]) => ({
        source: input.source,
        kind: input.kind,
        uploadedBy: input.uploadedBy,
        authorName: input.authorName,
        key: input.provenanceKey.startsWith('bg3-save:demo:'),
        png: input.bytes.subarray(1, 4).toString('ascii'),
      }),
    );
    const one = {
      source: 'bg3-save',
      kind: 'save',
      uploadedBy: 9,
      authorName: 'Shadowheart',
      key: true,
      png: 'PNG',
    };
    expect(inputs).toEqual([one, one]);
  });

  it('404s an unknown uploader and a missing hub; 400s a malformed body', async () => {
    const ctl = new HubMediaDemoSeedController(db);
    uploader.mockResolvedValue(undefined);
    await expect(
      ctl.seed({ guildId: 5, source: 'bg3-save', uploadedBy: 9 }),
    ).rejects.toThrow(new NotFoundException('User not found'));
    hiddenAt.mockResolvedValue(undefined);
    await expect(ctl.seed({ guildId: 5 })).rejects.toThrow(
      new NotFoundException('Guild not found'),
    );
    await expect(ctl.seed({ guildId: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fromSource).not.toHaveBeenCalled();
  });
});
