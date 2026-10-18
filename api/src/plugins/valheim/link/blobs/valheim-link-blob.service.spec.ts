import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ValheimLinkBlobRefRow } from '../../../../drizzle/schema';
import { rejection } from '../ingest/valheim-link-ingest.testing';
import { ValheimLinkBlobService } from './valheim-link-blob.service';
import { blobSource, fakePng, sha256Of } from './valheim-link-blob.testing';
import type { ValheimLinkBlobsRepository } from './valheim-link-blobs.repository';

const AUTH = { tokenId: 1, pelicanServerId: 7, serverId: '7' };
const code = (c: string) => expect.objectContaining({ code: c });
let dir: string;
let repo: jest.Mocked<
  Pick<ValheimLinkBlobsRepository, 'find' | 'insert' | 'findRefs' | 'touch'>
>;
let service: ValheimLinkBlobService;

function upload(body: Buffer, sha: string) {
  const src = blobSource({}, AUTH);
  src.end(body);
  return service.upload(src, sha);
}

const ref = (png: Buffer, role: ValheimLinkBlobRefRow['role'], w = 4) => ({
  sha256: sha256Of(png),
  byteLength: png.length,
  width: w,
  height: 4,
  role,
});

/** Files left in the server folder (temp files must never survive). */
const files = (): string[] => readdirSync(join(dir, '7'));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vl-blob-svc-'));
  process.env.VALHEIM_LINK_BLOB_DIR = dir;
  repo = {
    find: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue(true),
    findRefs: jest.fn().mockResolvedValue([]),
    touch: jest.fn().mockResolvedValue(undefined),
  };
  service = new ValheimLinkBlobService(
    repo as unknown as ValheimLinkBlobsRepository,
  );
});

afterAll(() => {
  delete process.env.VALHEIM_LINK_BLOB_DIR;
});

describe('ValheimLinkBlobService (ROK-1833)', () => {
  it('stores a new blob at <server>/<sha>.png and inserts its row', async () => {
    const png = fakePng(4, 4);
    const sha = sha256Of(png);
    expect(await upload(png, sha)).toEqual({ status: 'stored', sha256: sha });
    expect(readFileSync(join(dir, '7', `${sha}.png`)).equals(png)).toBe(true);
    expect(files()).toEqual([`${sha}.png`]);
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        pelicanServerId: 7,
        sha256: sha,
        byteLength: png.length,
        width: 4,
        height: 4,
        storagePath: `7/${sha}.png`,
      }),
    );
    expect(repo.touch).not.toHaveBeenCalled();
  });

  it('a hash mismatch is 400 hash_mismatch and leaves no file', async () => {
    const png = fakePng(4, 4);
    const r = await rejection(upload(png, 'f'.repeat(64)));
    expect(r).toEqual({ status: 400, body: code('hash_mismatch') });
    expect(files()).toEqual([]);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('a non-hex path is 400 before any read', async () => {
    const r = await rejection(upload(fakePng(1, 1), 'NOT-A-SHA'));
    expect(r.status).toBe(400);
    expect(repo.findRefs).not.toHaveBeenCalled();
  });

  it('re-upload of a stored sha is exists, with no rewrite and no temp file', async () => {
    const png = fakePng(4, 4);
    const sha = sha256Of(png);
    repo.find.mockResolvedValue({
      pelicanServerId: 7,
      sha256: sha,
      byteLength: png.length,
      contentType: 'image/png',
      width: 4,
      height: 4,
      storagePath: `7/${sha}.png`,
      createdAt: new Date(),
      lastReferencedAt: null,
    });
    expect(await upload(png, sha)).toEqual({ status: 'exists', sha256: sha });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(files()).toEqual([]);
  });

  it('a ref whose byteLength/dims differ is blob_ref_mismatch and not stored', async () => {
    const png = fakePng(4, 4);
    repo.findRefs.mockResolvedValue([{ ...ref(png, 'atlas'), width: 8 }]);
    const r = await rejection(upload(png, sha256Of(png)));
    expect(r).toEqual({ status: 400, body: code('blob_ref_mismatch') });
    expect(files()).toEqual([]);
  });

  it('a matching ref is stamped last_referenced_at', async () => {
    const png = fakePng(4, 4);
    repo.findRefs.mockResolvedValue([ref(png, 'atlas')]);
    expect((await upload(png, sha256Of(png))).status).toBe('stored');
    expect(repo.touch).toHaveBeenCalledWith(7, sha256Of(png));
  });

  it('a blob referenced as the base map is capped at 4096 px', async () => {
    const png = fakePng(5000, 4);
    repo.findRefs.mockResolvedValue([ref(png, 'baseMap', 5000)]);
    const r = await rejection(upload(png, sha256Of(png)));
    expect(r).toEqual({ status: 400, body: code('png_too_large') });
    expect(existsSync(join(dir, '7', `${sha256Of(png)}.png`))).toBe(false);
  });
});
