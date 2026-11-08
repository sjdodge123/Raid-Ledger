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

/** Per-character + create import, unlink and the audit log. */
export const PROVIDERS = [
  AddonImportService,
  AddonCharacterUnlinkService,
  AddonImportCreateService,
  AddonImportAuditService,
];

/** Player import routes + the admin audit route. */
export const CONTROLLERS = [AddonImportController, AddonImportAdminController];
