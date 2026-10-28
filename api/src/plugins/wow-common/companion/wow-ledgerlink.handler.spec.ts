/**
 * ROK-1964 §6.2 — the `wow-ledgerlink` handler's outcome mapping: every
 * import outcome resolves (the ingest acks `accepted`); an addon-import reject
 * becomes a pinned companion code with fixed copy and never the import's
 * message text; any other error passes through untouched.
 */
import { HttpException } from '@nestjs/common';
import type {
  AddonImportErrorCode,
  AddonImportNewResultDto,
  WowLedgerlinkMessage,
} from '@raid-ledger/contract';
import type { CompanionHandlerContext } from '../../../companion/ingest/companion-handler.registry';
import type { AddonImportCreateService } from '../addon-import/addon-import-create.service';
import { AddonImportError } from '../addon-import/addon-import.errors';
import { RosterHeldError } from '../addon-import/addon-import-guild.guard';
import { WowLedgerlinkHandler } from './wow-ledgerlink.handler';
import {
  WOW_LEDGERLINK_EXPORT_PATH,
  WOW_LEDGERLINK_REJECT_MESSAGES,
  companionErrorForImport,
} from './wow-ledgerlink.errors';

const EXPORT = '!RL1!char!secret-looking-export-body';
const SECRET_TEXT = 'Ana Forever on Player-4395-0000BEEF';

const msg: WowLedgerlinkMessage = {
  envelopeVersion: 1,
  contract: 'wow-ledgerlink',
  contractVersion: 1,
  capturedAt: '2026-09-22T00:00:00Z',
  appVersion: '0.1.0',
  collectorVersion: '0.1.0',
  payload: { exportString: EXPORT },
};

const ctx = { userId: 7, deviceId: 3 } as CompanionHandlerContext;

function result(status: AddonImportNewResultDto['status']) {
  return {
    status,
    sections: [{ status }],
    target: { action: 'update', characterId: 'c1' },
  } as unknown as AddonImportNewResultDto;
}

function handlerWith(importNew: jest.Mock) {
  const service = { importNew } as unknown as AddonImportCreateService;
  return new WowLedgerlinkHandler(service);
}

/** The HttpException `p` rejects with (fails loudly otherwise). */
async function rejection(p: Promise<unknown>) {
  const err: unknown = await p.then(
    () => new Error('expected handle() to reject'),
    (e: unknown) => e,
  );
  if (!(err instanceof HttpException)) throw err;
  return { status: err.getStatus(), body: err.getResponse() };
}

describe('WowLedgerlinkHandler — registration shape', () => {
  it('is the device-only v1 handler with no latest-wins marker', () => {
    const h = handlerWith(jest.fn());
    expect(h.contract).toBe('wow-ledgerlink');
    expect(h.versions).toEqual([1]);
    expect(h.sources).toEqual(['device']);
    expect('latestWins' in h).toBe(false);
  });
});

describe('WowLedgerlinkHandler — import call (D2)', () => {
  it("imports the export string as the device's user, applied with no preview or confirm", async () => {
    const importNew = jest.fn().mockResolvedValue(result('applied'));
    await handlerWith(importNew).handle(ctx, msg);
    expect(importNew).toHaveBeenCalledTimes(1);
    expect(importNew).toHaveBeenCalledWith(7, {
      importString: EXPORT,
      dryRun: false,
    });
  });

  it.each(['applied', 'noop', 'stale'] as const)(
    'import outcome %s → resolves (the ingest acks accepted)',
    async (status) => {
      const importNew = jest.fn().mockResolvedValue(result(status));
      await expect(
        handlerWith(importNew).handle(ctx, msg),
      ).resolves.toBeUndefined();
    },
  );
});

describe('WowLedgerlinkHandler — reject mapping (§6.2)', () => {
  const cases: Array<[AddonImportErrorCode, number, string]> = [
    ['RATE_LIMITED', 429, 'rate_limited'],
    ['TOO_LARGE', 413, 'payload_too_large'],
    ['RULESET_REQUIRED', 400, 'invalid_payload'],
    ['BAD_HEADER', 400, 'invalid_payload'],
    ['NOT_IN_GUILD', 400, 'invalid_payload'],
    ['CHARACTER_CLAIMED', 400, 'invalid_payload'],
    ['GUID_CONFIRM_REQUIRED', 400, 'invalid_payload'],
  ];

  it.each(cases)(
    '%s → %d %s, fixed copy, addon code as the one issue',
    async (code, status, wire) => {
      const importNew = jest
        .fn()
        .mockRejectedValue(new AddonImportError(code, SECRET_TEXT));
      const got = await rejection(handlerWith(importNew).handle(ctx, msg));
      expect(got.status).toBe(status);
      expect(got.body).toEqual({
        code: wire,
        message:
          WOW_LEDGERLINK_REJECT_MESSAGES[
            wire as keyof typeof WOW_LEDGERLINK_REJECT_MESSAGES
          ],
        issues: [{ path: WOW_LEDGERLINK_EXPORT_PATH, code }],
      });
      expect(JSON.stringify(got.body)).not.toContain(SECRET_TEXT);
      expect(JSON.stringify(got.body)).not.toContain(EXPORT);
    },
  );

  it('a held roster (RosterHeldError) → 400 invalid_payload, not its roster copy', async () => {
    const held = new RosterHeldError(1, 40, 50, false);
    const importNew = jest.fn().mockRejectedValue(held);
    const got = await rejection(handlerWith(importNew).handle(ctx, msg));
    expect(got).toEqual({
      status: 400,
      body: expect.objectContaining({
        code: 'invalid_payload',
        issues: [{ path: WOW_LEDGERLINK_EXPORT_PATH, code: 'INVALID_PAYLOAD' }],
      }),
    });
    expect(JSON.stringify(got.body)).not.toContain(held.body.message);
  });

  it.each([' ', '  \n\t  '])(
    'a blank/whitespace-only export %j → 400 invalid_payload INVALID_PAYLOAD, never imported',
    async (exportString) => {
      const importNew = jest.fn().mockResolvedValue(result('applied'));
      const blank = { ...msg, payload: { exportString } };
      const got = await rejection(handlerWith(importNew).handle(ctx, blank));
      expect(got).toEqual({
        status: 400,
        body: {
          code: 'invalid_payload',
          message: WOW_LEDGERLINK_REJECT_MESSAGES.invalid_payload,
          issues: [{ path: WOW_LEDGERLINK_EXPORT_PATH, code: 'INVALID_PAYLOAD' }],
        },
      });
      expect(importNew).not.toHaveBeenCalled();
    },
  );

  it('a non-import error passes through unchanged', async () => {
    const boom = new Error('connection reset');
    expect(companionErrorForImport(boom)).toBe(boom);
    const importNew = jest.fn().mockRejectedValue(boom);
    await expect(handlerWith(importNew).handle(ctx, msg)).rejects.toBe(boom);
  });
});
