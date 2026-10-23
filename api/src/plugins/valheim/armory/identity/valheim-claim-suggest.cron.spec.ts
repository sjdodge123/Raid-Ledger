/**
 * ROK-1933 (Codex P2) — the claim-suggest tick is gated on the Valheim
 * plugin being active.
 */
import type { CronJobService } from '../../../../cron-jobs/cron-job.service';
import type { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { ValheimClaimSuggestCron } from './valheim-claim-suggest.cron';
import type { ValheimClaimSuggestService } from './valheim-claim-suggest.service';

function build(active: boolean) {
  const service = { scan: jest.fn().mockResolvedValue(1) };
  const cronJobService = {
    executeWithTracking: jest.fn((_name: string, fn: () => Promise<boolean>) =>
      fn(),
    ),
  };
  const registry = { isActive: jest.fn().mockReturnValue(active) };
  const cron = new ValheimClaimSuggestCron(
    service as unknown as ValheimClaimSuggestService,
    cronJobService as unknown as CronJobService,
    registry as unknown as PluginRegistryService,
  );
  return { cron, service, registry };
}

describe('ValheimClaimSuggestCron', () => {
  it('a deactivated Valheim plugin queues no DMs', async () => {
    const { cron, service, registry } = build(false);
    await cron.scan();
    expect(registry.isActive).toHaveBeenCalledWith(VALHEIM_PLUGIN_ID);
    expect(service.scan).not.toHaveBeenCalled();
  });

  it('an active plugin runs the scan', async () => {
    const { cron, service } = build(true);
    await cron.scan();
    expect(service.scan).toHaveBeenCalledTimes(1);
  });
});
