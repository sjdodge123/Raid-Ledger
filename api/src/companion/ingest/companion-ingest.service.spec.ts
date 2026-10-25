/**
 * ROK-1956 §4.1 step 11 / §4.2 with a mocked repository: device revalidation,
 * latest-wins (stale skips the handler), and rollback on a handler throw.
 * The test handler is registered HERE (D-4), never in a testing helper.
 */
import { HttpException } from '@nestjs/common';
import { z } from 'zod';
import type { CompanionContractTable } from '@raid-ledger/contract';
import type { CompanionDeviceTx } from '../devices/companion-device-lock';
import {
  CompanionHandlerRegistry,
  type CompanionContractHandler,
} from './companion-handler.registry';
import type { CompanionIngestLatestRepository } from './companion-ingest-latest.repository';
import type { CompanionIngestAuth } from './companion-ingest-request';
import { CompanionIngestService } from './companion-ingest.service';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const SAVED_AT = '2026-10-25T11:00:00.000Z';
const TX = {} as CompanionDeviceTx;

const TABLE: CompanionContractTable = {
  'test-save': {
    1: {
      schema: z.object({
        contract: z.literal('test-save'),
        contractVersion: z.literal(1),
        envelopeVersion: z.literal(1),
        capturedAt: z.string(),
        appVersion: z.string(),
        collectorVersion: z.string(),
        payload: z.object({ key: z.string(), savedAt: z.string() }),
      }),
      maxBytes: 4096,
      blobSlots: [],
      status: 'current',
    },
  },
};

type SaveMsg = { payload: { key: string; savedAt: string } };

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

function body(): Buffer {
  return Buffer.from(
    JSON.stringify({
      envelopeVersion: 1,
      contract: 'test-save',
      contractVersion: 1,
      capturedAt: '2026-10-25T11:59:00.000Z',
      appVersion: '1.0.0',
      collectorVersion: '1.0.0',
      payload: { key: 'camp-1', savedAt: SAVED_AT },
    }),
  );
}

function setup(over: { held?: boolean; advanced?: boolean } = {}) {
  const handle = jest.fn<Promise<void>, [unknown, unknown]>(() =>
    Promise.resolve(),
  );
  const testHandler: CompanionContractHandler<SaveMsg> = {
    contract: 'test-save',
    versions: [1],
    sources: ['device', 'session'],
    latestWins: (m) => ({
      key: m.payload.key,
      at: new Date(m.payload.savedAt),
    }),
    handle,
  };
  const registry = new CompanionHandlerRegistry(
    { isActive: () => true },
    TABLE,
  );
  registry.register('test-plugin', testHandler);
  const repo = {
    transaction: jest.fn((fn: (tx: CompanionDeviceTx) => Promise<unknown>) =>
      fn(TX),
    ),
    holdDevice: jest.fn(() => Promise.resolve(over.held ?? true)),
    advance: jest.fn(() => Promise.resolve(over.advanced ?? true)),
  };
  const service = new CompanionIngestService(
    registry,
    repo as unknown as CompanionIngestLatestRepository,
    TABLE,
  );
  return { service, repo, handle };
}

describe('CompanionIngestService', () => {
  it('a newer save advances the marker and runs the handler in the tx', async () => {
    const { service, repo, handle } = setup();
    await expect(
      service.ingest(DEVICE, 'test-save', body(), NOW),
    ).resolves.toEqual({
      status: 'accepted',
    });
    expect(repo.holdDevice).toHaveBeenCalledWith(TX, {
      deviceId: 3,
      tokenHash: 'h',
    });
    expect(repo.advance).toHaveBeenCalledWith(TX, {
      userId: 7,
      contract: 'test-save',
      key: 'camp-1',
      at: new Date(SAVED_AT),
    });
    expect(handle).toHaveBeenCalledWith(
      { tx: TX, userId: 7, via: 'device', deviceId: 3, receivedAt: NOW },
      expect.objectContaining({
        payload: { key: 'camp-1', savedAt: SAVED_AT },
      }),
    );
  });

  it('a not-newer save is stale and never reaches the handler', async () => {
    const { service, handle } = setup({ advanced: false });
    await expect(
      service.ingest(DEVICE, 'test-save', body(), NOW),
    ).resolves.toEqual({
      status: 'stale',
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('a device revoked before commit is 401 and nothing is written', async () => {
    const { service, repo, handle } = setup({ held: false });
    const err = await service
      .ingest(DEVICE, 'test-save', body(), NOW)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err instanceof HttpException && err.getResponse()).toMatchObject({
      code: 'unauthorized',
    });
    expect(repo.advance).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('the session path skips device revalidation', async () => {
    const { service, repo, handle } = setup();
    await service.ingest(SESSION, 'test-save', body(), NOW);
    expect(repo.holdDevice).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'session', deviceId: null }),
      expect.anything(),
    );
  });

  it('a handler throw propagates out of the transaction (rollback, 500)', async () => {
    const { service, handle } = setup();
    handle.mockRejectedValueOnce(new Error('boom'));
    await expect(
      service.ingest(DEVICE, 'test-save', body(), NOW),
    ).rejects.toThrow('boom');
  });

  it('validation failures never open a transaction', async () => {
    const { service, repo } = setup();
    const bad = Buffer.from('{}');
    await expect(
      service.ingest(DEVICE, 'test-save', bad, NOW),
    ).rejects.toBeInstanceOf(HttpException);
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});
