import { PelicanSyncResultSchema } from '@raid-ledger/contract';
import { PelicanAdminController } from './pelican-admin.controller';
import type { PelicanConfigService } from './pelican-config.service';
import type { PelicanStatusService } from './pelican-status.service';
import type { PelicanSyncService } from './pelican-sync.service';
import {
  emptyOutcome,
  type PelicanSyncCode,
  type PelicanSyncOutcome,
} from './pelican-sync.helpers';

const POLL = { polled: 3, failed: 1, skipped: 2 };

function build(outcome: PelicanSyncOutcome) {
  const syncServers = jest.fn<Promise<PelicanSyncOutcome>, []>(() =>
    Promise.resolve(outcome),
  );
  const pollStatuses = jest.fn(() => Promise.resolve({ ...POLL }));
  const controller = new PelicanAdminController(
    {} as PelicanConfigService,
    { syncServers } as unknown as PelicanSyncService,
    { pollStatuses } as unknown as PelicanStatusService,
  );
  return { controller, syncServers, pollStatuses };
}

describe('PelicanAdminController.syncNow (ROK-1772)', () => {
  it('polls status once after a successful sync and returns both', async () => {
    const ok = {
      code: 'ok' as const,
      upserted: 5,
      markedMissing: 1,
      restored: 2,
    };
    const { controller, syncServers, pollStatuses } = build(ok);

    const result = await controller.syncNow();

    expect(syncServers).toHaveBeenCalledTimes(1);
    expect(pollStatuses).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      code: 'ok',
      message: expect.stringContaining('Synced 5 server(s)') as unknown,
      upserted: 5,
      markedMissing: 1,
      restored: 2,
      status: POLL,
    });
    expect(PelicanSyncResultSchema.parse(result)).toEqual(result);
  });

  it('answers in_progress without polling when a sync is already running', async () => {
    const { controller, pollStatuses } = build(emptyOutcome('in_progress'));

    const result = await controller.syncNow();

    expect(pollStatuses).not.toHaveBeenCalled();
    expect(result.code).toBe('in_progress');
    expect(result.status).toBeNull();
    expect(result.message).toMatch(/already running/);
  });

  const failures: PelicanSyncCode[] = [
    'not_configured',
    'partial_listing',
    'internal_error',
    'unauthorized',
    'network',
    'http',
  ];
  it.each(failures)('does not poll when the sync returns %s', async (code) => {
    const { controller, pollStatuses } = build(emptyOutcome(code));

    const result = await controller.syncNow();

    expect(pollStatuses).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code, status: null, upserted: 0 });
    expect(result.message).not.toBe('');
    expect(PelicanSyncResultSchema.safeParse(result).success).toBe(true);
  });
});
