/**
 * ROK-1965 — `HubMediaService.ingestUpload`: the provenance gate (D5) and
 * the row it hands the shared store tail. Repository + store tail mocked.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { HubMediaDownloader } from './hub-media-download';
import { bytesUsed, findByKey } from './hub-media.repository';
import { encodeAndStore } from './hub-media-store.helpers';
import { HubMediaService } from './hub-media.service';
import { uploadProvenanceKey } from './hub-media.types';

jest.mock('./hub-media.repository', () => ({
  bytesUsed: jest.fn(),
  findByKey: jest.fn(),
  markRemoved: jest.fn(),
}));
jest.mock('./hub-media-store.helpers', () => ({
  ...jest.requireActual<object>('./hub-media-store.helpers'),
  encodeAndStore: jest.fn(),
}));

const db = {} as PostgresJsDatabase<typeof schema>;
const downloader: HubMediaDownloader = { download: jest.fn() };
const bytes = Buffer.from('png-bytes');
const input = {
  guildId: 7,
  uploaderId: 42,
  authorName: 'Ada',
  caption: null,
  bytes,
};

describe('HubMediaService.ingestUpload', () => {
  const service = new HubMediaService(db, downloader);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(bytesUsed).mockResolvedValue(0);
  });

  it('refuses bytes that were removed from this hub', async () => {
    jest
      .mocked(findByKey)
      .mockResolvedValue({ id: 3, removedAt: new Date('2026-10-01') });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'rejected',
      reason: 'removed',
    });
    expect(encodeAndStore).not.toHaveBeenCalled();
  });

  it('returns the live row for a double-submit', async () => {
    jest.mocked(findByKey).mockResolvedValue({ id: 3, removedAt: null });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'duplicate',
      mediaId: 3,
    });
    expect(encodeAndStore).not.toHaveBeenCalled();
  });

  it('stores an upload row keyed by the bytes and owned by the uploader', async () => {
    jest.mocked(findByKey).mockResolvedValue(undefined);
    jest
      .mocked(encodeAndStore)
      .mockResolvedValue({ status: 'stored', mediaId: 9 });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'stored',
      mediaId: 9,
    });
    expect(jest.mocked(encodeAndStore).mock.calls[0]?.[1]).toMatchObject({
      source: 'upload',
      kind: 'upload',
      provenanceKey: uploadProvenanceKey(bytes),
      uploadedBy: 42,
      discord: null,
    });
  });

  it('maps a store-tail cap to a cap rejection', async () => {
    jest.mocked(findByKey).mockResolvedValue(undefined);
    jest.mocked(encodeAndStore).mockResolvedValue({ status: 'cap' });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'rejected',
      reason: 'cap',
    });
  });
});
