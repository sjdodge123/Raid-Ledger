/**
 * ROK-2100 §4 B.2 — the handler tells the member (via the notice service,
 * which owns the 7-day dedup) when a companion create is refused with
 * `RULESET_REQUIRED`; the device's 400 is unchanged. Other rejects and a
 * `RULESET_REQUIRED` without a create `detail` never notify.
 */
import { HttpException } from '@nestjs/common';
import type { WowLedgerlinkMessage } from '@raid-ledger/contract';
import type { CompanionAfterCommitContext } from '../../../companion/ingest/companion-handler.registry';
import type { AddonImportCreateService } from '../addon-import/addon-import-create.service';
import {
  AddonImportError,
  type AddonImportRulesetDetail,
} from '../addon-import/addon-import.errors';
import type { LedgerlinkRulesetNoticeService } from './ledgerlink-ruleset-notice.service';
import { WowLedgerlinkHandler } from './wow-ledgerlink.handler';

const msg: WowLedgerlinkMessage = {
  envelopeVersion: 1,
  contract: 'wow-ledgerlink',
  contractVersion: 1,
  capturedAt: '2026-09-22T00:00:00Z',
  appVersion: '0.1.0',
  collectorVersion: '0.1.0',
  payload: { exportString: '!RL1!char!body' },
};

const ctx: CompanionAfterCommitContext = {
  userId: 7,
  via: 'device',
  deviceId: 3,
  receivedAt: new Date('2026-09-22T00:00:01Z'),
};

const DETAIL: AddonImportRulesetDetail = {
  characterName: 'Ana Forever',
  realmName: 'CAMWOW US2 Realm 9',
  guid: 'Player-4395-0000BEEF',
};

function setup(err: unknown) {
  const importNew = jest.fn().mockRejectedValue(err);
  const notify = jest.fn().mockResolvedValue(undefined);
  const handler = new WowLedgerlinkHandler(
    { importNew } as unknown as AddonImportCreateService,
    {
      notifyRulesetRequired: notify,
    } as unknown as LedgerlinkRulesetNoticeService,
  );
  return { handler, notify };
}

/** The status + body the handler rejects with (fails loudly otherwise). */
async function rejection(p: Promise<unknown>) {
  const err: unknown = await p.then(
    () => new Error('expected handle() to reject'),
    (e: unknown) => e,
  );
  if (!(err instanceof HttpException)) throw err;
  return { status: err.getStatus(), body: err.getResponse() };
}

describe('WowLedgerlinkHandler — RULESET_REQUIRED notice (ROK-2100 B.2)', () => {
  it('a create refused with RULESET_REQUIRED notifies once, then rejects 400 as before', async () => {
    const reject = new AddonImportError('RULESET_REQUIRED', undefined, {
      detail: DETAIL,
    });
    const { handler, notify } = setup(reject);
    const got = await rejection(handler.handle(ctx, msg));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(7, DETAIL);
    expect(got.status).toBe(400);
    expect(JSON.stringify(got.body)).toContain('RULESET_REQUIRED');
  });

  it('a RULESET_REQUIRED with no create detail → no notice', async () => {
    const { handler, notify } = setup(new AddonImportError('RULESET_REQUIRED'));
    await rejection(handler.handle(ctx, msg));
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(['WRONG_GAME', 'CHARACTER_CLAIMED', 'INVALID_PAYLOAD'] as const)(
    '%s → no notice',
    async (code) => {
      const err = new AddonImportError(code, undefined, { detail: DETAIL });
      const { handler, notify } = setup(err);
      await rejection(handler.handle(ctx, msg));
      expect(notify).not.toHaveBeenCalled();
    },
  );
});
