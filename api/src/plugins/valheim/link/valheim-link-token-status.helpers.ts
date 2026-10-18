import {
  ValheimLinkTokenStatusSchema,
  type ValheimLinkTokenState,
  type ValheimLinkTokenStatus,
} from '@raid-ledger/contract';
import type { ValheimLinkTokenStatusRow } from './valheim-link-tokens.repository';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** none = never issued; revoked = `revoked_at` set; else active. */
export function tokenStateOf(
  row: ValheimLinkTokenStatusRow,
): ValheimLinkTokenState {
  if (row.tokenHint === null) return 'none';
  return row.revokedAt ? 'revoked' : 'active';
}

/** The strict admin status DTO — a hash or token key cannot pass the parse. */
export function toTokenStatusDto(
  row: ValheimLinkTokenStatusRow,
): ValheimLinkTokenStatus {
  return ValheimLinkTokenStatusSchema.parse({
    pelicanServerId: row.pelicanServerId,
    serverId: String(row.pelicanServerId),
    state: tokenStateOf(row),
    tokenHint: row.tokenHint,
    createdAt: iso(row.createdAt),
    rotatedAt: iso(row.rotatedAt),
    revokedAt: iso(row.revokedAt),
    lastUsedAt: iso(row.lastUsedAt),
  });
}
