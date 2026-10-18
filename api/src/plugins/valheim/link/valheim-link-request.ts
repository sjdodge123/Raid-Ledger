import { ForbiddenException } from '@nestjs/common';
import type { ValheimLinkIngestErrorCode } from '@raid-ledger/contract';

/** What `ValheimLinkBearerGuard` attaches to an authenticated ingest request. */
export interface ValheimLinkAuth {
  tokenId: number;
  pelicanServerId: number;
  /** Wire `serverId` = `String(pelican_servers.id)`. */
  serverId: string;
}

/** An ingest request after the bearer guard ran. */
export interface ValheimLinkRequest {
  headers: Record<string, string | string[] | undefined>;
  valheimLink?: ValheimLinkAuth;
}

/** `{ code, message }` — the ingest error body (`ValheimLinkIngestErrorSchema`). */
export function ingestError(
  code: ValheimLinkIngestErrorCode,
  message: string,
): { code: ValheimLinkIngestErrorCode; message: string } {
  return { code, message };
}

/**
 * L3's message handler calls this after parse: the body `serverId` must be
 * the token's server, else 403 `server_mismatch`. Returns the auth record.
 */
export function assertServerMatches(
  req: ValheimLinkRequest,
  bodyServerId: string,
): ValheimLinkAuth {
  const auth = req.valheimLink;
  if (!auth || auth.serverId !== bodyServerId) {
    throw new ForbiddenException(
      ingestError('server_mismatch', 'serverId is not this token’s server'),
    );
  }
  return auth;
}
