/**
 * ROK-1955 (for C3's ingest writes): commit-time revalidation of a device
 * token, the ValheimLink `holdActiveToken` precedent
 * (`valheim-link-token-lock.ts`). `SELECT … FOR SHARE` on the device row (pk
 * lookup) inside the write's transaction: true only while the row still
 * carries the hash that authenticated the request and is not revoked. A
 * concurrent revoke (`UPDATE`) waits for the share lock or is seen.
 * Owner deactivation is checked by the guard per request, not here.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { CompanionDeviceAuth } from './companion-device-request';

type Db = PostgresJsDatabase<typeof schema>;
/** A drizzle transaction handle on the app schema. */
export type CompanionDeviceTx = Parameters<
  Parameters<Db['transaction']>[0]
>[0];

/** Share-lock the authenticated device row; false once it is revoked. */
export async function holdActiveDevice(
  tx: CompanionDeviceTx,
  auth: Pick<CompanionDeviceAuth, 'deviceId' | 'tokenHash'>,
): Promise<boolean> {
  const d = schema.companionDevices;
  const rows = await tx
    .select({ id: d.id })
    .from(d)
    .where(
      and(
        eq(d.id, auth.deviceId),
        eq(d.tokenHash, auth.tokenHash),
        isNull(d.revokedAt),
      ),
    )
    .for('share');
  return rows.length > 0;
}
