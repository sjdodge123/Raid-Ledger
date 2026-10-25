/**
 * ROK-1956 §7.1 — the blob upload verify order with a mocked repository,
 * reader and paths: each check runs in spec order, a failure stops every
 * later step, and the temp file is always discarded.
 */
import { HttpException } from '@nestjs/common';
import type { CompanionIngestAuth } from '../ingest/companion-ingest-request';
import { companionError } from '../ingest/companion-ingest.errors';
import * as paths from './companion-blob.paths';
import * as reader from './companion-blob.reader';
import type { CompanionBlobUpload } from './companion-blob.service';
import { CompanionBlobService } from './companion-blob.service';
import type { CompanionBlobsRepository } from './companion-blobs.repository';

jest.mock('./companion-blob.reader', () => ({
  assertBlobRequestHeaders: jest.fn(),
  readCompanionBlobToFile: jest.fn(),
  assertSharpAgrees: jest.fn(),
}));
jest.mock('./companion-blob.paths', () => ({
  companionBlobTempPath: jest.fn(),
  commitCompanionBlob: jest.fn(),
  discardCompanionBlobFile: jest.fn(),
}));

const SHA = 'a'.repeat(64);
const TMP = '/blobs/7/.upload-0000000000000000.tmp';
const GOT = { sha256: SHA, byteLength: 100, width: 64, height: 32 };
const DEVICE: CompanionIngestAuth = {
  userId: 7,
  via: 'device',
  deviceId: 3,
  tokenHash: 'h',
};
const REQ = {
  headers: { 'content-length': '100' },
} as unknown as CompanionBlobUpload;

const m = {
  headers: jest.mocked(reader.assertBlobRequestHeaders),
  read: jest.mocked(reader.readCompanionBlobToFile),
  sharp: jest.mocked(reader.assertSharpAgrees),
  temp: jest.mocked(paths.companionBlobTempPath),
  commit: jest.mocked(paths.commitCompanionBlob),
  discard: jest.mocked(paths.discardCompanionBlobFile),
};

function setup(
  over: {
    stored?: boolean;
    used?: number;
    refs?: object[];
    insert?: string;
  } = {},
) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) =>
    jest.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });
  const repo = {
    find: track('find', over.stored ? GOT : null),
    usage: track('usage', over.used ?? 0),
    findRefs: track('findRefs', over.refs ?? []),
    insert: track('insert', over.insert ?? 'stored'),
    remove: track('remove', undefined),
  };
  m.headers.mockImplementation(() => void calls.push('headers'));
  m.temp.mockImplementation(() => (calls.push('temp'), Promise.resolve(TMP)));
  m.read.mockImplementation(() => (calls.push('read'), Promise.resolve(GOT)));
  m.sharp.mockImplementation(() => (calls.push('sharp'), Promise.resolve()));
  m.commit.mockImplementation(() => (calls.push('commit'), Promise.resolve()));
  m.discard.mockImplementation(
    () => (calls.push('discard'), Promise.resolve()),
  );
  const service = new CompanionBlobService(
    repo as unknown as CompanionBlobsRepository,
  );
  return { service, repo, calls };
}

async function codeOf(p: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await p;
  } catch (err: unknown) {
    if (err instanceof HttpException) {
      const body = err.getResponse() as { code?: unknown };
      return [err.getStatus(), body.code];
    }
    throw err;
  }
  throw new Error('expected an HttpException, the upload resolved');
}

beforeEach(() => jest.clearAllMocks());

describe('CompanionBlobService.upload — happy path and idempotency', () => {
  it('runs every step in spec order and answers stored', async () => {
    const { service, calls } = setup();
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'stored',
      sha256: SHA,
    });
    expect(calls).toEqual([
      'find',
      'headers',
      'usage',
      'temp',
      'read',
      'findRefs',
      'sharp',
      'insert',
      'commit',
      'discard',
    ]);
    expect(m.commit).toHaveBeenCalledWith(TMP, 7, SHA);
  });

  it('an already-stored sha answers exists without reading the body', async () => {
    const { service, calls } = setup({ stored: true });
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'exists',
      sha256: SHA,
    });
    expect(calls).toEqual(['find']);
  });

  it('a lost insert race answers exists and never renames', async () => {
    const { service, calls } = setup({ insert: 'exists' });
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'exists',
      sha256: SHA,
    });
    expect(calls).not.toContain('commit');
    expect(calls.at(-1)).toBe('discard');
  });
});

describe('CompanionBlobService.upload — refusals stop later steps', () => {
  it('a non-hex path sha is 400 hash_mismatch before any lookup', async () => {
    const { service, calls } = setup();
    await expect(
      codeOf(service.upload(DEVICE, '../etc', REQ)),
    ).resolves.toEqual([400, 'hash_mismatch']);
    await expect(
      codeOf(service.upload(DEVICE, SHA.toUpperCase(), REQ)),
    ).resolves.toEqual([400, 'hash_mismatch']);
    expect(calls).toEqual([]);
  });

  it('a 415 from the header check comes before the quota read', async () => {
    const { service, calls } = setup();
    m.headers.mockImplementation(() => {
      throw companionError('unsupported_media', 'Unsupported content-type');
    });
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      415,
      'unsupported_media',
    ]);
    expect(calls).toEqual(['find']);
  });

  it('stored + declared bytes over the quota is 413 before the body is read', async () => {
    process.env.COMPANION_BLOB_QUOTA_BYTES_PER_USER = '150';
    try {
      const { service, calls } = setup({ used: 60 });
      await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
        413,
        'blob_quota_exceeded',
      ]);
      expect(calls).toEqual(['find', 'headers', 'usage']);
    } finally {
      delete process.env.COMPANION_BLOB_QUOTA_BYTES_PER_USER;
    }
  });

  it('a body whose hash differs from the path is 400 hash_mismatch, nothing stored', async () => {
    const { service, calls } = setup();
    m.read.mockResolvedValue({ ...GOT, sha256: 'b'.repeat(64) });
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      400,
      'hash_mismatch',
    ]);
    expect(calls).not.toContain('findRefs');
    expect(calls).not.toContain('insert');
    expect(m.discard).toHaveBeenCalledWith(TMP);
  });

  it('a ref that disagrees on width is 409 blob_ref_mismatch before sharp', async () => {
    const { service, calls } = setup({
      refs: [{ byteLength: 100, width: 65, height: 32 }],
    });
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      409,
      'blob_ref_mismatch',
    ]);
    expect(calls).not.toContain('sharp');
    expect(calls).not.toContain('insert');
  });

  it('sharp disagreeing is 400 invalid_blob before the insert', async () => {
    const { service, calls } = setup();
    m.sharp.mockRejectedValue(companionError('invalid_blob', 'x'));
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      400,
      'invalid_blob',
    ]);
    expect(calls).not.toContain('insert');
  });

  it('a device revoked at commit is 401; a quota lost at commit is 413', async () => {
    const revoked = setup({ insert: 'revoked' });
    await expect(
      codeOf(revoked.service.upload(DEVICE, SHA, REQ)),
    ).resolves.toEqual([401, 'unauthorized']);
    const full = setup({ insert: 'quota_exceeded' });
    await expect(
      codeOf(full.service.upload(DEVICE, SHA, REQ)),
    ).resolves.toEqual([413, 'blob_quota_exceeded']);
    expect(full.calls).not.toContain('commit');
  });

  it('a failed rename deletes the row and answers a generic 500', async () => {
    const { service, repo } = setup();
    m.commit.mockRejectedValue(
      Object.assign(new Error('EXDEV'), { code: 'EXDEV' }),
    );
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      500,
      undefined,
    ]);
    expect(repo.remove).toHaveBeenCalledWith(7, SHA);
    expect(m.discard).toHaveBeenCalledWith(TMP);
  });
});
