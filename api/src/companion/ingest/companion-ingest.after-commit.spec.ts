/**
 * ROK-1964 (Codex P1) — the after-commit handler mode: the ingest
 * transaction only revalidates the device and commits; the handler then runs
 * OUTSIDE it (so a handler that opens its own transaction never holds two
 * pooled connections). A rolled-back or failed commit never reaches the
 * handler. The test handler is registered HERE (D-4).
 */
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { CompanionContractTable } from '@raid-ledger/contract';
import type { CompanionDeviceTx } from '../devices/companion-device-lock';
import {
  CompanionHandlerRegistry,
  type CompanionAfterCommitHandler,
} from './companion-handler.registry';
import type { CompanionIngestLatestRepository } from './companion-ingest-latest.repository';
import type { CompanionIngestAuth } from './companion-ingest-request';
import { CompanionIngestService } from './companion-ingest.service';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const TX = {} as CompanionDeviceTx;

const TABLE: CompanionContractTable = {
  'test-import': {
    1: {
      schema: z.object({
        contract: z.literal('test-import'),
        contractVersion: z.literal(1),
        envelopeVersion: z.literal(1),
        capturedAt: z.string(),
        appVersion: z.string(),
        collectorVersion: z.string(),
        payload: z.object({ text: z.string() }),
      }),
      maxBytes: 4096,
      blobSlots: [],
      status: 'current',
    },
  },
};

const DEVICE: CompanionIngestAuth = {
  userId: 7,
  via: 'device',
  deviceId: 3,
  tokenHash: 'h',
};

function body(): Buffer {
  return Buffer.from(
    JSON.stringify({
      envelopeVersion: 1,
      contract: 'test-import',
      contractVersion: 1,
      capturedAt: '2026-10-25T11:59:00.000Z',
      appVersion: '1.0.0',
      collectorVersion: '1.0.0',
      payload: { text: 'x' },
    }),
  );
}

interface SetupOver {
  held?: boolean;
  commitFails?: boolean;
}

function setup(over: SetupOver = {}) {
  const events: string[] = [];
  const handle = jest.fn<Promise<void>, [unknown, unknown]>(() => {
    events.push('handle');
    return Promise.resolve();
  });
  const handler: CompanionAfterCommitHandler = {
    contract: 'test-import',
    versions: [1],
    afterCommit: true,
    handle,
  };
  const registry = new CompanionHandlerRegistry(
    { isActive: () => true },
    TABLE,
  );
  registry.register('test-plugin', handler);
  const repo = {
    transaction: jest.fn(
      async (fn: (tx: CompanionDeviceTx) => Promise<unknown>) => {
        events.push('tx:open');
        const out = await fn(TX);
        if (over.commitFails) throw new Error('commit failed');
        events.push('tx:commit');
        return out;
      },
    ),
    holdDevice: jest.fn(() => {
      events.push('holdDevice');
      return Promise.resolve(over.held ?? true);
    }),
    advance: jest.fn(() => Promise.resolve(true)),
    lockUserBlobs: jest.fn(() => Promise.resolve()),
    storedBlobs: jest.fn(() => Promise.resolve([])),
    recordBlobRefs: jest.fn(() => Promise.resolve()),
  };
  const service = new CompanionIngestService(
    registry,
    repo as unknown as CompanionIngestLatestRepository,
    TABLE,
  );
  return { service, repo, handle, events };
}

describe('CompanionIngestService — after-commit handlers', () => {
  it('verifies the device in the tx, commits, THEN runs the handler (no tx handed over)', async () => {
    const { service, repo, handle, events } = setup();
    await expect(
      service.ingest(DEVICE, 'test-import', body(), NOW),
    ).resolves.toEqual({ status: 'accepted' });
    expect(events).toEqual(['tx:open', 'holdDevice', 'tx:commit', 'handle']);
    expect(repo.holdDevice).toHaveBeenCalledWith(TX, {
      deviceId: 3,
      tokenHash: 'h',
    });
    expect(handle).toHaveBeenCalledWith(
      { userId: 7, via: 'device', deviceId: 3, receivedAt: NOW },
      expect.objectContaining({ payload: { text: 'x' } }),
    );
    const ctx: unknown = handle.mock.calls[0]?.[0];
    expect(ctx).not.toHaveProperty('tx');
  });

  it('a revoked device (hold fails) → 401 and the handler never runs', async () => {
    const { service, handle } = setup({ held: false });
    const err: unknown = await service
      .ingest(DEVICE, 'test-import', body(), NOW)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err instanceof HttpException ? err.getStatus() : 0).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it('a failed commit (rolled back) never reaches the handler', async () => {
    const { service, handle } = setup({ commitFails: true });
    await expect(
      service.ingest(DEVICE, 'test-import', body(), NOW),
    ).rejects.toThrow('commit failed');
    expect(handle).not.toHaveBeenCalled();
  });

  it("a handler throw after commit surfaces as the request's error", async () => {
    const { service, handle } = setup();
    handle.mockRejectedValueOnce(new Error('import rejected'));
    await expect(
      service.ingest(DEVICE, 'test-import', body(), NOW),
    ).rejects.toThrow('import rejected');
  });
});

describe('CompanionHandlerRegistry — after-commit handlers', () => {
  const base: CompanionAfterCommitHandler = {
    contract: 'test-import',
    versions: [1],
    afterCommit: true,
    handle: () => Promise.resolve(),
  };

  it.each([
    ['latestWins', { latestWins: () => null }],
    ['blobRefs', { blobRefs: () => [] }],
  ])(
    'refuses an after-commit handler declaring %s (its tx state would commit without the handler)',
    (_name, extra) => {
      const registry = new CompanionHandlerRegistry(
        { isActive: () => true },
        TABLE,
      );
      expect(() =>
        registry.register('test-plugin', { ...base, ...extra }),
      ).toThrow(/after-commit/);
    },
  );
});
