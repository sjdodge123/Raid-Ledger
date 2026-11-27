/**
 * LedgerLink addon-import Nest classes, spread into `WowCommonModule`
 * (keeps that module under the 300-line limit).
 */
import { AddonImportController } from './addon-import.controller';
import { AddonImportAdminController } from './addon-import-admin.controller';
import { AddonCharacterUnlinkService } from './addon-import.unlink';
import { AddonImportService } from './addon-import.service';
import { AddonImportCreateService } from './addon-import-create.service';
import { AddonImportAuditService } from './addon-import.audit';
import { WowUserLifecycleRegistrar } from './wow-user-lifecycle.hooks';

/** Per-character + create import, unlink, the audit log, and the
 * USER_LIFECYCLE hooks registrar (ROK-2364, registers unconditionally). */
export const PROVIDERS = [
  WowUserLifecycleRegistrar,
  AddonImportService,
  AddonCharacterUnlinkService,
  AddonImportCreateService,
  AddonImportAuditService,
];

/** Player import routes + the admin audit route. */
export const CONTROLLERS = [AddonImportController, AddonImportAdminController];
