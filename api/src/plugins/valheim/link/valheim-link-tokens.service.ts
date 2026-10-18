import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ValheimLinkTokenIssuedSchema,
  type ValheimLinkTokenIssued,
  type ValheimLinkTokenListResponse,
  type ValheimLinkTokenStatus,
} from '@raid-ledger/contract';
import { VALHEIM_GAME_SLUG } from '../valheim.constants';
import {
  generateValheimLinkToken,
  hashValheimLinkToken,
  tokenHintOf,
} from './valheim-link-token.helpers';
import { toTokenStatusDto } from './valheim-link-token-status.helpers';
import { ValheimLinkTokensRepository } from './valheim-link-tokens.repository';

/**
 * Admin token lifecycle (ROK-1833). The plaintext exists only inside
 * `issue` and its return value — it never reaches a logger.
 */
@Injectable()
export class ValheimLinkTokensService {
  constructor(private readonly repo: ValheimLinkTokensRepository) {}

  /** Every Valheim-mapped server's token status. */
  async list(): Promise<ValheimLinkTokenListResponse> {
    const rows = await this.repo.listValheimStatuses();
    return { data: rows.map(toTokenStatusDto) };
  }

  /** One server's status. 404 unknown server, 400 not mapped to Valheim. */
  async status(id: number): Promise<ValheimLinkTokenStatus> {
    await this.requireValheimServer(id);
    return toTokenStatusDto(await this.repo.getStatus(id));
  }

  /**
   * Issue a token. 409 when one is live and `rotate` is false — decided by
   * the write itself, so two concurrent Generates cannot both succeed; with
   * `rotate` the old hash is overwritten in the same statement.
   */
  async issue(
    id: number,
    userId: number | null,
    rotate: boolean,
  ): Promise<ValheimLinkTokenIssued> {
    await this.requireValheimServer(id);
    const token = generateValheimLinkToken();
    const args = [
      id,
      hashValheimLinkToken(token),
      tokenHintOf(token),
      userId,
    ] as const;
    if (rotate) await this.repo.upsertToken(...args);
    else if (!(await this.repo.issueIfNoneActive(...args))) {
      throw new ConflictException('A token is already active; rotate it');
    }
    const status = toTokenStatusDto(await this.repo.getStatus(id));
    return ValheimLinkTokenIssuedSchema.parse({
      token,
      serverId: String(id),
      status,
    });
  }

  /** Revoke the live token. 404 unknown server or no live token. */
  async revoke(id: number): Promise<ValheimLinkTokenStatus> {
    const server = await this.repo.findServer(id);
    if (!server) throw new NotFoundException('Server not found');
    if (!(await this.repo.revoke(id))) {
      throw new NotFoundException('No active token');
    }
    return toTokenStatusDto(await this.repo.getStatus(id));
  }

  private async requireValheimServer(id: number): Promise<void> {
    const server = await this.repo.findServer(id);
    if (!server) throw new NotFoundException('Server not found');
    if (server.gameSlug !== VALHEIM_GAME_SLUG) {
      throw new BadRequestException('Server is not mapped to Valheim');
    }
  }
}
