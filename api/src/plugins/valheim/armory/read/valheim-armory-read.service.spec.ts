/**
 * ROK-1836 D5 (ROK-1837 review) — the sha-keyed blob route resolves a
 * stored `storage_path` only inside the blob root: a tampered `../` row
 * is a 404, never a read outside it.
 */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ValheimArmoryReadRepository } from './valheim-armory-read.repository';
import { ValheimArmoryReadService } from './valheim-armory-read.service';

const ORIGINAL = process.env.VALHEIM_LINK_BLOB_DIR;
let storagePath: string | null;

async function service(): Promise<ValheimArmoryReadService> {
  const mod = await Test.createTestingModule({
    providers: [
      ValheimArmoryReadService,
      {
        provide: ValheimArmoryReadRepository,
        useValue: { findBlobPath: () => Promise.resolve(storagePath) },
      },
    ],
  }).compile();
  return mod.get(ValheimArmoryReadService);
}

beforeEach(() => {
  process.env.VALHEIM_LINK_BLOB_DIR = '/srv/vh-blobs';
});

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.VALHEIM_LINK_BLOB_DIR;
  else process.env.VALHEIM_LINK_BLOB_DIR = ORIGINAL;
});

describe('ValheimArmoryReadService.blobPath', () => {
  it('resolves a stored path inside the blob root', async () => {
    storagePath = '7/abc.png';
    expect(await (await service()).blobPath(7, 'abc')).toBe(
      '/srv/vh-blobs/7/abc.png',
    );
  });

  it('404s a storage_path that escapes the blob root', async () => {
    storagePath = '../../etc/passwd';
    await expect((await service()).blobPath(7, 'abc')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
