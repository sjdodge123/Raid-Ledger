import { gzipSync } from 'node:zlib';
import type { ValheimLinkRequest } from '../valheim-link-request';
import { ValheimLinkIngestService } from './valheim-link-ingest.service';
import { loadValheimFixture, rejection } from './valheim-link-ingest.testing';
import type { ValheimLinkSnapshotsRepository } from './valheim-link-snapshots.repository';

const NOW = new Date('2026-10-17T20:20:00Z');
const req: ValheimLinkRequest = {
  headers: {},
  valheimLink: {
    tokenId: 1,
    tokenHash: 'h',
    pelicanServerId: 7,
    serverId: 'srv_fixture_01',
  },
};
const code = (c: string) => expect.objectContaining({ code: c });
const buf = (o: unknown): Buffer => Buffer.from(JSON.stringify(o));

function setup(written: boolean | 'revoked' = true) {
  const result = written === true ? 'written' : written || 'stale';
  const repo = {
    upsertLatest: jest.fn().mockResolvedValue(result),
    findBlobs: jest.fn().mockResolvedValue([]),
  };
  const service = new ValheimLinkIngestService(
    repo as unknown as ValheimLinkSnapshotsRepository,
  );
  return { repo, service };
}

describe('ValheimLinkIngestService (ROK-1833)', () => {
  it('accepts a newer snapshot and upserts it pending on the contract key', async () => {
    const { repo, service } = setup(true);
    const msg = loadValheimFixture('character-vanilla');
    const res = await service.ingest(req, 'character', buf(msg), NOW);
    expect(res).toEqual({ status: 'accepted', missingBlobs: [] });
    const row = repo.upsertLatest.mock.calls[0]?.[0];
    expect(row).toMatchObject({
      pelicanServerId: 7,
      kind: 'character',
      status: 'pending',
    });
    expect(row?.snapshotKey).toMatch(/^\d{17}:-?\d+$/);
  });

  it('reports stale when the stored capturedAt is newer or equal', async () => {
    const { service } = setup(false);
    const res = await service.ingest(
      req,
      'character',
      buf(loadValheimFixture('character-vanilla')),
      NOW,
    );
    expect(res.status).toBe('stale');
  });

  it('400 captured_at_in_future past now + 5 min; nothing written', async () => {
    const { repo, service } = setup();
    const msg = {
      ...loadValheimFixture('character-vanilla'),
      capturedAt: '2026-10-17T20:25:01Z',
    };
    const r = await rejection(service.ingest(req, 'character', buf(msg), NOW));
    expect(r).toEqual({ status: 400, body: code('captured_at_in_future') });
    expect(repo.upsertLatest).not.toHaveBeenCalled();
  });

  it('400 schema_invalid with { path, code } issues and no value echo', async () => {
    const { service } = setup();
    const msg = {
      ...loadValheimFixture('character-vanilla'),
      modVersion: 'SECRET-not-semver',
    };
    const r = await rejection(service.ingest(req, 'character', buf(msg), NOW));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      code: 'schema_invalid',
      issues: [{ path: 'modVersion' }],
    });
    expect(JSON.stringify(r.body)).not.toContain('SECRET');
  });

  it('400 bad_json and 400 kind_mismatch', async () => {
    const { service } = setup();
    const bad = await rejection(
      service.ingest(req, 'character', Buffer.from('{'), NOW),
    );
    expect(bad).toEqual({ status: 400, body: code('bad_json') });
    const msg = buf(loadValheimFixture('character-vanilla'));
    expect(await rejection(service.ingest(req, 'map', msg, NOW))).toEqual({
      status: 400,
      body: code('kind_mismatch'),
    });
  });

  it('403 server_mismatch when the body serverId is not the token’s', async () => {
    const { repo, service } = setup();
    const msg = {
      ...loadValheimFixture('character-vanilla'),
      serverId: 'other',
    };
    const r = await rejection(service.ingest(req, 'character', buf(msg), NOW));
    expect(r).toEqual({ status: 403, body: code('server_mismatch') });
    expect(repo.upsertLatest).not.toHaveBeenCalled();
  });

  it('400 bitmap_invalid on a two-member gzip bitmap that passes Zod', async () => {
    const { service } = setup();
    const msg = loadValheimFixture('map-personal');
    const explored = msg['explored'];
    if (typeof explored !== 'object' || explored === null)
      throw new Error('explored');
    const gz = Buffer.from(String(Reflect.get(explored, 'data')), 'base64');
    const twoMember = Buffer.concat([gz, gzipSync(Buffer.alloc(0))]);
    const bad = {
      ...msg,
      explored: { ...explored, data: twoMember.toString('base64') },
    };
    const r = await rejection(service.ingest(req, 'map', buf(bad), NOW));
    expect(r).toEqual({ status: 400, body: code('bitmap_invalid') });
  });

  it('records blob refs, lists unmet ones, and 400s a ref that differs from a stored blob', async () => {
    const { repo, service } = setup();
    const msg = loadValheimFixture('items-atlas');
    const res = await service.ingest(req, 'items', buf(msg), NOW);
    const row = repo.upsertLatest.mock.calls[0]?.[0];
    expect(row?.blobRefs).toEqual([expect.objectContaining({ role: 'atlas' })]);
    expect(res.missingBlobs).toEqual([row?.blobRefs?.[0]?.sha256]);
    const sha = String(row?.blobRefs?.[0]?.sha256);
    repo.findBlobs.mockResolvedValueOnce([
      { sha256: sha, byteLength: 1, width: 1, height: 1 },
    ]);
    const r = await rejection(service.ingest(req, 'items', buf(msg), NOW));
    expect(r).toEqual({ status: 400, body: code('blob_ref_mismatch') });
  });
});

describe('ValheimLinkIngestService — commit revalidation (ROK-1833)', () => {
  it('401 invalid_token when the token was rotated/revoked after the guard', async () => {
    const { repo, service } = setup('revoked');
    const msg = loadValheimFixture('character-vanilla');
    const r = await rejection(service.ingest(req, 'character', buf(msg), NOW));
    expect(r).toEqual({ status: 401, body: code('invalid_token') });
    expect(repo.upsertLatest).toHaveBeenCalledWith(expect.anything(), {
      tokenId: 1,
      tokenHash: 'h',
      pelicanServerId: 7,
      serverId: 'srv_fixture_01',
    });
  });
});
