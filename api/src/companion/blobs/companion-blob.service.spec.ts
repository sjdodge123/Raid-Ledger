/**
 * ROK-1956 §7.1 — the blob upload verify order with a mocked repository,
 * reader and paths: each check runs in spec order, a failure stops every
 * later step, and the temp file is always discarded.
 */
import { HttpException } from '@nestjs/common';
import { COMPANION_WEBP_MAX_BYTES } from '@raid-ledger/contract';
import type { CompanionHandlerRegistry } from '../ingest/companion-handler.registry';
import type { CompanionIngestAuth } from '../ingest/companion-ingest-request';
import { companionError } from '../ingest/companion-ingest.errors';
import * as paths from './companion-blob.paths';
import * as reader from './companion-blob.reader';
import type { CompanionBlobUpload } from './companion-blob.service';
import { CompanionBlobService } from './companion-blob.service';
import type { CompanionBlobReservations } from './companion-blob-reservations';
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
  companionBlobFileExists: jest.fn(),
  fsErrorCode: jest.requireActual<typeof import('./companion-blob.paths')>(
    './companion-blob.paths',
  ).fsErrorCode,
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
const SESSION: CompanionIngestAuth = {
  userId: 7,
  via: 'session',
  deviceId: null,
  tokenHash: null,
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
  fileExists: jest.mocked(paths.companionBlobFileExists),
};

function setup(
  over: {
    stored?: boolean;
    used?: number;
    refs?: object[];
    insert?: string;
    fileExists?: boolean;
    reserved?: boolean;
    sessionOk?: boolean;
    staleRemoved?: boolean;
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
    removeStale: track('removeStale', over.staleRemoved ?? true),
  };
  const holds = {
    reserve: track('reserve', over.reserved === false ? null : 42),
    release: track('release', undefined),
  };
  const registry = {
    acceptsSessionBlobs: jest.fn(() => over.sessionOk ?? false),
  };
  m.fileExists.mockImplementation(
    () => (calls.push('fileExists'), Promise.resolve(over.fileExists ?? true)),
  );
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
    registry as unknown as CompanionHandlerRegistry,
    holds as unknown as CompanionBlobReservations,
  );
  return { service, repo, registry, holds, calls };
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
      'reserve',
      'temp',
      'read',
      'findRefs',
      'sharp',
      'insert',
      'commit',
      'discard',
      'release',
    ]);
    expect(m.commit).toHaveBeenCalledWith(TMP, 7, SHA);
  });

  it('an already-stored sha answers exists without reading the body', async () => {
    const { service, calls } = setup({ stored: true });
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'exists',
      sha256: SHA,
    });
    expect(calls).toEqual(['find', 'fileExists']);
  });

  it('a lost insert race answers exists and never renames', async () => {
    const { service, calls } = setup({ insert: 'exists' });
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'exists',
      sha256: SHA,
    });
    expect(calls).not.toContain('commit');
    expect(calls.slice(-2)).toEqual(['discard', 'release']);
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

describe('CompanionBlobService.upload — review round 1', () => {
  it('a row whose file is gone: the stale row is removed under the lock and the upload is stored again', async () => {
    const { service, repo, calls } = setup({ stored: true, fileExists: false });
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'stored',
      sha256: SHA,
    });
    expect(repo.removeStale).toHaveBeenCalledWith(7, SHA);
    expect(calls.slice(0, 4)).toEqual([
      'find',
      'fileExists',
      'removeStale',
      'headers',
    ]);
    expect(m.commit).toHaveBeenCalledWith(TMP, 7, SHA);
  });

  it('a row without its file that removeStale keeps (young / file back) → 200 exists; nothing read or stored', async () => {
    const { service, repo, calls } = setup({
      stored: true,
      fileExists: false,
      staleRemoved: false,
    });
    await expect(service.upload(DEVICE, SHA, REQ)).resolves.toEqual({
      status: 'exists',
      sha256: SHA,
    });
    expect(calls).toEqual(['find', 'fileExists', 'removeStale']);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('a session upload is 401 when no enabled handler opts into the session path', async () => {
    const { service, calls } = setup();
    await expect(codeOf(service.upload(SESSION, SHA, REQ))).resolves.toEqual([
      401,
      'unauthorized',
    ]);
    expect(calls).toEqual([]);
  });

  it('a session upload proceeds when a handler opts into the session path', async () => {
    const { service } = setup({ sessionOk: true });
    await expect(service.upload(SESSION, SHA, REQ)).resolves.toEqual({
      status: 'stored',
      sha256: SHA,
    });
  });

  it('the global disk cap refuses before streaming (413 blob_quota_exceeded)', async () => {
    process.env.COMPANION_BLOB_TOTAL_MAX_BYTES = '1000';
    try {
      const { service, holds, calls } = setup({ reserved: false });
      await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
        413,
        'blob_quota_exceeded',
      ]);
      expect(calls).toEqual(['find', 'headers', 'usage', 'reserve']);
      expect(holds.reserve).toHaveBeenCalledWith(100, 1000);
    } finally {
      delete process.env.COMPANION_BLOB_TOTAL_MAX_BYTES;
    }
  });

  it('reserves the declared length and caps the read to it', async () => {
    const { service, holds } = setup();
    await service.upload(DEVICE, SHA, REQ);
    expect(holds.reserve).toHaveBeenCalledWith(100, expect.any(Number));
    expect(m.read.mock.calls[0]?.[1]).toBe(100);
  });

  it('a chunked body (no Content-Length) reserves the contract max', async () => {
    const { service, holds } = setup();
    const chunked = { headers: {} } as unknown as CompanionBlobUpload;
    await service.upload(DEVICE, SHA, chunked);
    expect(holds.reserve).toHaveBeenCalledWith(
      COMPANION_WEBP_MAX_BYTES,
      expect.any(Number),
    );
    expect(m.read.mock.calls[0]?.[1]).toBe(COMPANION_WEBP_MAX_BYTES);
  });

  it('a failure after reserving releases the reservation', async () => {
    const { service, holds, calls } = setup({ insert: 'ref_mismatch' });
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      409,
      'blob_ref_mismatch',
    ]);
    expect(holds.release).toHaveBeenCalledWith(42);
    expect(calls.at(-1)).toBe('release');
  });

  it('refs that disagree once re-read under the lock are 409 and never renamed', async () => {
    const { service, calls } = setup({ insert: 'ref_mismatch' });
    await expect(codeOf(service.upload(DEVICE, SHA, REQ))).resolves.toEqual([
      409,
      'blob_ref_mismatch',
    ]);
    expect(calls).not.toContain('commit');
  });
});
