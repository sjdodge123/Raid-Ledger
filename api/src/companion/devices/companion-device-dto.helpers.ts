/**
 * ROK-1955: DB row → strict contract DTO. The strict parse means a hash, a
 * plaintext code or a token can never ride along in an added key.
 */
import {
  CompanionDeviceOsSchema,
  CompanionDeviceSchema,
  CompanionLinkPreviewSchema,
  type CompanionDevice,
  type CompanionDeviceOs,
  type CompanionLinkPreview,
} from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { coarseIp, formatUserCode } from './companion-device-token.helpers';

export type CompanionDeviceRow = typeof schema.companionDevices.$inferSelect;
export type CompanionDeviceLinkRow =
  typeof schema.companionDeviceLinks.$inferSelect;

/** A stored OS string → the contract enum (`other` for null / unknown). */
export function osOf(value: string | null): CompanionDeviceOs {
  const parsed = CompanionDeviceOsSchema.safeParse(value);
  return parsed.success ? parsed.data : 'other';
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A device row as its owner sees it — never the token hash. */
export function toCompanionDeviceDto(row: CompanionDeviceRow): CompanionDevice {
  return CompanionDeviceSchema.parse({
    id: row.id,
    name: row.name,
    os: osOf(row.os),
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    tokenHint: row.tokenHint,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: iso(row.lastUsedAt),
    lastUsedNetwork: row.lastUsedIpCoarse,
    revokedAt: iso(row.revokedAt),
    state: row.revokedAt ? 'revoked' : 'active',
  });
}

/** The approve page's view of a pending link (D-10). */
export function toLinkPreview(
  row: CompanionDeviceLinkRow,
  userCode: string,
  viewerIp: string | undefined,
): CompanionLinkPreview {
  const network = row.requestedIpCoarse;
  return CompanionLinkPreviewSchema.parse({
    userCode: formatUserCode(userCode),
    device: {
      name: row.deviceName ?? 'Companion device',
      os: osOf(row.deviceOs),
      ...(row.deviceOsVersion ? { osVersion: row.deviceOsVersion } : {}),
      appVersion: row.appVersion ?? '0.0.0',
    },
    requestedAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    requestedNetwork: network ?? 'unknown',
    sameNetworkAsYou: network !== null && network === coarseIp(viewerIp),
    status: 'pending',
  });
}
