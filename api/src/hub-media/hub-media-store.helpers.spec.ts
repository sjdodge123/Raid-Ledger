/**
 * ROK-1965 — the store tail shared by Discord ingest and member uploads.
 * Encode, files and repository are mocked: these pin the ORDER of steps
 * (no files on a reject, files unlinked on every non-stored outcome).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { encodeHubMedia } from './hub-media.encode';
import { unlinkMediaFiles, writeMediaFiles } from './hub-media.files';
import {
  bytesUsed,
  findByKey,
  insertIgnore,
  withHubMediaCapLock,
} from './hub-media.repository';
import {
  encodeAndStore,
  toRow,
  type HubMediaStoreRow,
} from './hub-media-store.helpers';
import { uploadProvenanceKey } from './hub-media.types';

jest.mock('./hub-media.encode', () => ({ encodeHubMedia: jest.fn() }));
jest.mock('./hub-media.files', () => ({
  writeMediaFiles: jest.fn(),
  unlinkMediaFiles: jest.fn(),
}));
jest.mock('./hub-media.repository', () => ({
  bytesUsed: jest.fn(),
  findByKey: jest.fn(),
  insertIgnore: jest.fn(),
  withHubMediaCapLock: jest.fn(),
}));

type Db = PostgresJsDatabase<typeof schema>;
const db = {} as Db;
const encoded = {
  full: Buffer.alloc(600),
  thumb: Buffer.alloc(400),
  width: 20,
  height: 10,
};
const uploadRow: HubMediaStoreRow = {
  guildId: 7,
  source: 'upload',
  kind: 'upload',
  provenanceKey: 'upload:sha256:abc',
  authorName: 'Ada',
  caption: null,
  capturedAt: new Date('2026-10-26T00:00:00Z'),
  discord: null,
  uploadedBy: 42,
};

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.HUB_MEDIA_MAX_BYTES_PER_HUB;
  jest.mocked(encodeHubMedia).mockResolvedValue(encoded);
  jest
    .mocked(withHubMediaCapLock)
    .mockImplementation((tx, _guildId, fn) => fn(tx));
  jest.mocked(bytesUsed).mockResolvedValue(0);
});

describe('uploadProvenanceKey', () => {
  it('is the sha256 of the bytes under an upload prefix', () => {
    const key = uploadProvenanceKey(Buffer.from('abc'));
    expect(key).toBe(
      'upload:sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(uploadProvenanceKey(Buffer.from('abd'))).not.toBe(key);
  });
});

describe('toRow', () => {
  it('records the uploader, truncates free text and sums both files', () => {
    const row = toRow(
      { ...uploadRow, authorName: 'x'.repeat(80), caption: 'c'.repeat(250) },
      encoded,
      'uuid-1',
    );
    expect(row).toMatchObject({
      uploadedBy: 42,
      source: 'upload',
      kind: 'upload',
      discordMessageId: null,
      storageName: 'uuid-1',
      bytes: 1000,
    });
    expect(row.authorName).toHaveLength(64);
    expect(row.caption).toHaveLength(200);
  });
});

describe('encodeAndStore', () => {
  it('refuses a non-image without writing files', async () => {
    jest.mocked(encodeHubMedia).mockResolvedValue(null);
    const out = await encodeAndStore(db, uploadRow, Buffer.from('x'), 0);
    expect(out).toEqual({ status: 'not_image' });
    expect(writeMediaFiles).not.toHaveBeenCalled();
  });

  it('fails fast on the cap before writing files', async () => {
    process.env.HUB_MEDIA_MAX_BYTES_PER_HUB = '1500';
    const out = await encodeAndStore(db, uploadRow, Buffer.from('x'), 600);
    expect(out).toEqual({ status: 'cap' });
    expect(writeMediaFiles).not.toHaveBeenCalled();
  });

  it('stores the row with uploaded_by and keeps the files', async () => {
    jest.mocked(insertIgnore).mockResolvedValue(11);
    const out = await encodeAndStore(db, uploadRow, Buffer.from('x'), 0);
    expect(out).toEqual({ status: 'stored', mediaId: 11 });
    expect(jest.mocked(insertIgnore).mock.calls[0]?.[1]).toMatchObject({
      uploadedBy: 42,
      provenanceKey: 'upload:sha256:abc',
    });
    expect(unlinkMediaFiles).not.toHaveBeenCalled();
  });

  it('re-checks the cap under the lock and unlinks when it no longer fits', async () => {
    process.env.HUB_MEDIA_MAX_BYTES_PER_HUB = '1500';
    jest.mocked(bytesUsed).mockResolvedValue(900);
    const out = await encodeAndStore(db, uploadRow, Buffer.from('x'), 0);
    expect(out).toEqual({ status: 'cap' });
    expect(insertIgnore).not.toHaveBeenCalled();
    expect(unlinkMediaFiles).toHaveBeenCalledTimes(1);
  });

  it('returns the race winner as a duplicate and unlinks its own files', async () => {
    jest.mocked(insertIgnore).mockResolvedValue(null);
    jest.mocked(findByKey).mockResolvedValue({ id: 5, removedAt: null });
    const out = await encodeAndStore(db, uploadRow, Buffer.from('x'), 0);
    expect(out).toEqual({ status: 'duplicate', mediaId: 5 });
    expect(unlinkMediaFiles).toHaveBeenCalledTimes(1);
  });

  it('unlinks and rethrows when the insert throws', async () => {
    jest.mocked(insertIgnore).mockRejectedValue(new Error('db down'));
    await expect(
      encodeAndStore(db, uploadRow, Buffer.from('x'), 0),
    ).rejects.toThrow('db down');
    expect(unlinkMediaFiles).toHaveBeenCalledTimes(1);
  });
});
