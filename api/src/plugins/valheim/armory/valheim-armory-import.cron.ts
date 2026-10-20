import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  EXTENSION_POINTS,
  type CronRegistrar,
} from '../../plugin-host/extension-points';
import type { CronJobDefinition } from '../../plugin-host/extension-types';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { ValheimArmoryImportService } from './valheim-armory-import.service';

/** Every 30 s (D1, FLAG Q12); six-field cron with seconds. */
export const VALHEIM_ARMORY_IMPORT_CRON = '*/30 * * * * *';
/** Registered as `valheim:armory-import` by the plugin cron manager. */
export const VALHEIM_ARMORY_IMPORT_JOB = 'armory-import';

/**
 * ROK-1835: registers the armory drain as a Valheim plugin cron job, owned by
 * the plugin id so the registry suspends it while the plugin is inactive.
 * The handler never throws. Specs call `ValheimArmoryImportService.drainOnce`
 * directly instead of waiting for a tick (test-app stops every cron).
 */
@Injectable()
export class ValheimArmoryImportCron implements CronRegistrar, OnModuleInit {
  private readonly logger = new Logger(ValheimArmoryImportCron.name);

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly importer: ValheimArmoryImportService,
  ) {}

  onModuleInit(): void {
    this.registry.registerAdapter(
      EXTENSION_POINTS.CRON_REGISTRAR,
      VALHEIM_PLUGIN_ID,
      this,
      { ownerPluginId: VALHEIM_PLUGIN_ID },
    );
  }

  getCronJobs(): CronJobDefinition[] {
    return [
      {
        name: VALHEIM_ARMORY_IMPORT_JOB,
        cronExpression: VALHEIM_ARMORY_IMPORT_CRON,
        handler: () => this.drain(),
      },
    ];
  }

  private async drain(): Promise<void> {
    try {
      await this.importer.drainOnce();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : 'unknown';
      this.logger.error(`valheim-armory drain failed (${name})`);
    }
  }
}
