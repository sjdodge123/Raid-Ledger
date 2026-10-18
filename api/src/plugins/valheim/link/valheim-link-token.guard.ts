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
import {
  ingestError,
  type ValheimLinkAuth,
  type ValheimLinkRequest,
} from './valheim-link-request';
import {
  authFailureLimit,
  rateLimited,
  WINDOW_MS,
} from './valheim-link-rate-limit.guard';
import { ValheimLinkRateLimiter } from './valheim-link-rate-limiter';
import { ValheimLinkTokensRepository } from './valheim-link-tokens.repository';

type HeaderSink = { setHeader?: (n: string, v: string) => void } | undefined;

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
 * Pre-auth limiter: an IP with `VALHEIM_LINK_RATE_AUTH_PER_MIN` (30) failed
 * attempts in the minute gets 429 `rate_limited` BEFORE the DB lookup;
 * successful auths do not count. This guard never logs: the header is a secret.
 */
@Injectable()
export class ValheimLinkBearerGuard implements CanActivate {
  constructor(
    private readonly repo: ValheimLinkTokensRepository,
    private readonly registry: PluginRegistryService,
    private readonly limiter: ValheimLinkRateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<ValheimLinkRequest>();
    this.assertPluginsActive();
    const key = `valheim-link:auth:${req.ip ?? 'unknown'}`;
    const limit = authFailureLimit();
    if (limit !== null && this.limiter.isExhausted(key, limit, WINDOW_MS)) {
      const retry = String(this.limiter.retryAfter(key, WINDOW_MS));
      http.getResponse<HeaderSink>()?.setHeader?.('Retry-After', retry);
      throw rateLimited('Too many failed token attempts');
    }
    try {
      req.valheimLink = await this.authenticate(req);
    } catch (err: unknown) {
      if (limit !== null && err instanceof UnauthorizedException) {
        this.limiter.hit(key, limit, WINDOW_MS);
      }
      throw err;
    }
    await this.repo.touchLastUsed(req.valheimLink.tokenId);
    return true;
  }

  /** Bearer → token row → auth record; throws the 401 / 403 above. */
  private async authenticate(
    req: ValheimLinkRequest,
  ): Promise<ValheimLinkAuth> {
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
    return {
      tokenId: row.tokenId,
      tokenHash: row.tokenHash,
      pelicanServerId: row.pelicanServerId,
      serverId: String(row.pelicanServerId),
    };
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
