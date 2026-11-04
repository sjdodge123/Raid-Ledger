/**
 * ROK-1966 review P1/P2 — the store's transaction-aware side: `openIn`
 * looks the blob up on the caller's tx (never the outer pool, which an
 * in-tx ingest handler would deadlock on at `DB_POOL_MAX=1`), and
 * `releaseHeldRefsIn` drops refs on that same tx.
 */
import { CompanionBlobStore } from './companion-blob.store';
import type { CompanionBlobsRepository } from './companion-blobs.repository';

const SHA = 'ab'.repeat(32);
type OpenTx = Parameters<CompanionBlobStore['openIn']>[0];
type ReleaseTx = Parameters<CompanionBlobStore['releaseHeldRefsIn']>[0];

function selectTx(rows: unknown[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn(() => ({ where }));
  return { select: jest.fn(() => ({ from })), where };
}

function store() {
  const repo = { find: jest.fn().mockResolvedValue(null) };
  const blobs = new CompanionBlobStore(
    repo as unknown as CompanionBlobsRepository,
  );
  return { blobs, repo };
}

describe('CompanionBlobStore.openIn — metadata lookup rides the caller tx', () => {
  it('queries the given tx and never the outer-pool repository', async () => {
    const { blobs, repo } = store();
    const tx = selectTx([]);
    await expect(
      blobs.openIn(tx as unknown as OpenTx, 7, SHA),
    ).resolves.toBeNull();
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(tx.where).toHaveBeenCalledTimes(1);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('a row whose file is missing opens as null (no throw)', async () => {
    const { blobs, repo } = store();
    const tx = selectTx([{ sha256: SHA, byteLength: 4, width: 1, height: 1 }]);
    await expect(
      blobs.openIn(tx as unknown as OpenTx, 999_999, SHA),
    ).resolves.toBeNull();
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('a malformed sha opens as null without touching any connection', async () => {
    const { blobs, repo } = store();
    const tx = selectTx([]);
    await expect(
      blobs.openIn(tx as unknown as OpenTx, 7, 'nope'),
    ).resolves.toBeNull();
    expect(tx.select).not.toHaveBeenCalled();
    expect(repo.find).not.toHaveBeenCalled();
  });
});

describe('CompanionBlobStore.releaseHeldRefsIn', () => {
  it('deletes on the given tx and reports the count; no shas → no statement', async () => {
    const { blobs } = store();
    const where = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { delete: jest.fn(() => ({ where })) };
    await expect(
      blobs.releaseHeldRefsIn(tx as unknown as ReleaseTx, 7, 'bg3-screenshot', [
        SHA,
      ]),
    ).resolves.toBe(1);
    expect(tx.delete).toHaveBeenCalledTimes(1);
    await expect(
      blobs.releaseHeldRefsIn(
        tx as unknown as ReleaseTx,
        7,
        'bg3-screenshot',
        [],
      ),
    ).resolves.toBe(0);
    expect(tx.delete).toHaveBeenCalledTimes(1);
  });
});
