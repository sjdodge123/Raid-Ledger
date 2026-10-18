import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PELICAN_SERVER_GAME_CHANGED } from '../../pelican/pelican.constants';
import { ValheimLinkTokensRepository } from './valheim-link-tokens.repository';

/**
 * ROK-1833: a Pelican row re-mapped away from Valheim loses its live ingest
 * token at once. Awaited by the PATCH (`emitAsync`). A failure is logged
 * (server id only) and swallowed — the bearer guard's game check still
 * refuses ingest for a non-Valheim row.
 */
@Injectable()
export class ValheimLinkRemapListener {
  private readonly logger = new Logger(ValheimLinkRemapListener.name);

  constructor(private readonly repo: ValheimLinkTokensRepository) {}

  /** Revoke the server's live token unless it is still mapped to Valheim. */
  @OnEvent(PELICAN_SERVER_GAME_CHANGED)
  async handleGameChanged(payload: { serverId: number }): Promise<void> {
    try {
      if (await this.repo.revokeIfNotValheim(payload.serverId)) {
        this.logger.log(
          `Revoked Valheim Link token: server ${payload.serverId} left Valheim`,
        );
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.name : 'unknown';
      this.logger.warn(
        `Valheim Link token revoke failed for server ${payload.serverId} (${reason})`,
      );
    }
  }
}
