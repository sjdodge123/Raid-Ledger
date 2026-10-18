import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import {
  hashValheimLinkToken,
  isValheimLinkToken,
  tokenHashesEqual,
} from './valheim-link-token.helpers';
import { ingestError, type ValheimLinkRequest } from './valheim-link-request';
import { ValheimLinkTokensRepository } from './valheim-link-tokens.repository';

const invalidToken = (): UnauthorizedException =>
  new UnauthorizedException(ingestError('invalid_token', 'Invalid token'));

/** The raw bearer value, or null. Never logged. */
function bearerOf(req: ValheimLinkRequest): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * ROK-1833 ingest auth. 403 while Valheim or Pelican is inactive (no DB
 * read); 401 `invalid_token` for a malformed (no DB read), unknown,
 * rotated or revoked token — one code, no oracle; 403 `server_not_valheim`
 * when the row was re-mapped or went missing. Attaches `req.valheimLink`.
 * This guard never logs: the header is a secret.
 */
@Injectable()
export class ValheimLinkBearerGuard implements CanActivate {
  constructor(
    private readonly repo: ValheimLinkTokensRepository,
    private readonly registry: PluginRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ValheimLinkRequest>();
    this.assertPluginsActive();
    const token = bearerOf(req);
    if (token === null || !isValheimLinkToken(token)) throw invalidToken();
    const hash = hashValheimLinkToken(token);
    const row = await this.repo.findByHash(hash);
    if (!row || !tokenHashesEqual(row.tokenHash, hash) || row.revokedAt) {
      throw invalidToken();
    }
    if (row.missingSince || row.gameSlug !== VALHEIM_GAME_SLUG) {
      throw new ForbiddenException(
        ingestError('server_not_valheim', 'Server is not mapped to Valheim'),
      );
    }
    req.valheimLink = {
      tokenId: row.tokenId,
      pelicanServerId: row.pelicanServerId,
      serverId: String(row.pelicanServerId),
    };
    await this.repo.touchLastUsed(row.tokenId);
    return true;
  }

  private assertPluginsActive(): void {
    const active = this.registry.getActiveSlugsSync();
    for (const slug of [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID]) {
      if (!active.has(slug)) {
        throw new ForbiddenException(`Plugin "${slug}" is not active`);
      }
    }
  }
}
