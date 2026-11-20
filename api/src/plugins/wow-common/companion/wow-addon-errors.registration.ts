import { WowAddonErrorsAdminController } from '../addon-errors-admin/wow-addon-errors-admin.controller';
import { WowAddonErrorsAdminService } from '../addon-errors-admin/wow-addon-errors-admin.service';
import { WowAddonErrorsRetentionCron } from './wow-addon-errors-retention.cron';

/**
 * ROK-2099 — the `blizzard` plugin's addon-error pieces besides the handler
 * (which `WowCommonModule` injects directly): the D7 90-day retention cron
 * and the S3 admin reads + export. Kept here so the module stays under the
 * 300-line limit.
 */
export const CONTROLLERS = [WowAddonErrorsAdminController];
export const PROVIDERS = [
  WowAddonErrorsRetentionCron,
  WowAddonErrorsAdminService,
];
