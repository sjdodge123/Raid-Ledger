import { z } from 'zod';
import { HubNameSchema } from './community-hubs.schema.js';

/**
 * ROK-1950 — `PATCH /guilds/:id/name`: rename a hub (leader + staff). A string
 * follows the create rules (`HubNameSchema`); `null` drops a server hub's Raid
 * Ledger name so it follows the Pelican server name again (community hubs 400).
 */
export const HubRenameSchema = z
  .object({ name: HubNameSchema.nullable() })
  .strict();
export type HubRenameDto = z.infer<typeof HubRenameSchema>;
