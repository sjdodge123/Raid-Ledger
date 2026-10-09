/**
 * ROK-1592: Google OAuth connect (plan L2/L4/L10/L11/L12).
 *
 * - `GET /users/me/calendars/oauth/:provider/start` (JWT + kill switch):
 *   mints the signed PKCE state, binds it to this browser with an httpOnly
 *   cookie and answers `{ url }` for the consent screen.
 * - `GET /calendar-sync/oauth/:provider/callback` (public — the browser
 *   arrives from Google): verifies the state + cookie, exchanges the code and
 *   stores the connection, then 302s to `/profile/gaming/calendars` with
 *   `?connected=<provider>` or `?error=<CalendarOAuthErrorCode>` — never a
 *   500 (an unexpected error lands on `?error=unavailable`). A grant whose
 *   upsert fails is revoked best-effort.
 *
 * The logic lives in the services/providers helpers; this file only routes.
 * Never log a token, code or state.
 */
import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as Sentry from '@sentry/nestjs';
import type { Request as ExpressRequest, Response } from 'express';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  CalendarOAuthErrorCode,
  OAuthStartResponse,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { AuthenticatedRequest } from '../../auth/types';
import {
  assertLinkStateBoundToBrowser,
  bindLinkStateToBrowser,
  type LinkStateProvider,
} from '../../auth/link-state-cookie.helpers';
import { SettingsService } from '../../settings/settings.service';
import { getClientUrl } from '../../settings/settings-bot.helpers';
import {
  getCalendarSyncEnabled,
  type CalendarOAuthProvider,
} from '../../settings/settings-calendar-sync.helpers';
import { CalendarSyncEnabledGuard } from '../calendar-sync-enabled.guard';
import type { CalendarAccountProvider } from '../providers/calendar-provider.interface';
import { CalendarProviderRegistry } from '../providers/calendar-provider.registry';
import {
  CalendarProviderError,
  ProviderNotConfiguredError,
} from '../providers/calendar-provider.errors';
import { MissingScopesError } from '../providers/google/google-oauth.helpers';
import { buildRedirectUris } from '../services/calendar-sync-admin.helpers';
import {
  mintCalendarOAuthState,
  verifyCalendarOAuthState,
} from '../services/calendar-oauth-state.helpers';
import {
  revokeUnstoredGrant,
  upsertCalendarConnection,
} from '../services/calendar-connect.helpers';

/** Where every callback lands (L3: no `returnTo`, so no open redirect). */
export const CALENDARS_PAGE_PATH = '/profile/gaming/calendars';

/** Browser-binding cookie key per provider (L4). Microsoft: ROK-1597. */
const LINK_KEYS: Partial<Record<CalendarOAuthProvider, LinkStateProvider>> = {
  google: 'calendar-google',
};

interface OAuthTarget {
  key: CalendarOAuthProvider;
  link: LinkStateProvider;
  provider: CalendarAccountProvider;
}

function firstString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Known connect/upsert failure → callback code; null for anything else. */
function knownErrorCode(err: unknown): CalendarOAuthErrorCode | null {
  if (err instanceof MissingScopesError) return 'scopes';
  if (err instanceof ProviderNotConfiguredError) return 'unavailable';
  if (err instanceof CalendarProviderError) return 'exchange';
  return null;
}

/** The class only: a message may echo a response body or a token. */
function errorClass(err: unknown): string {
  return err instanceof Error ? err.constructor.name : typeof err;
}

@Controller()
export class CalendarOAuthController {
  private readonly logger = new Logger(CalendarOAuthController.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly registry: CalendarProviderRegistry,
  ) {}

  @Get('users/me/calendars/oauth/:provider/start')
  @UseGuards(AuthGuard('jwt'), CalendarSyncEnabledGuard)
  async start(
    @Param('provider') raw: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OAuthStartResponse> {
    const target = this.resolve(raw);
    if (!target || !(await target.provider.isConfigured())) {
      throw new NotFoundException();
    }
    const { state, codeChallenge } = mintCalendarOAuthState({
      uid: req.user.id,
      provider: target.key,
      bindToBrowser: () => bindLinkStateToBrowser(res, target.link),
    });
    const redirectUri = await this.redirectUri(target.key);
    const url = await target.provider.buildAuthUrl({
      state,
      codeChallenge,
      redirectUri,
    });
    return { url };
  }

  @Get('calendar-sync/oauth/:provider/callback')
  async callback(
    @Param('provider') raw: string,
    @Query() query: Record<string, unknown>,
    @Req() req: ExpressRequest,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.complete(raw, query, req, res).catch(
      (err: unknown) => this.failureCode(err),
    );
    if (outcome !== 'connected') {
      this.logger.warn(`calendar oauth callback failed (${outcome})`);
    }
    const qs =
      outcome === 'connected' ? `connected=${raw}` : `error=${outcome}`;
    const base = (await getClientUrl(this.settings)).replace(/\/+$/, '');
    res.redirect(`${base}${CALENDARS_PAGE_PATH}?${qs}`);
  }

  private async complete(
    raw: string,
    query: Record<string, unknown>,
    req: ExpressRequest,
    res: Response,
  ): Promise<'connected' | CalendarOAuthErrorCode> {
    if (!(await getCalendarSyncEnabled(this.settings))) return 'disabled';
    const target = this.resolve(raw);
    if (!target) return 'unavailable';
    const verified = await verifyCalendarOAuthState(
      this.db,
      firstString(query.state) ?? '',
      {
        provider: target.key,
        assertBoundToBrowser: (r) =>
          assertLinkStateBoundToBrowser(req, res, target.link, r),
      },
    );
    if (!verified) return 'state';
    const error = firstString(query.error);
    if (error) return error === 'access_denied' ? 'denied' : 'exchange';
    const code = firstString(query.code);
    if (!code) return 'exchange';
    return this.connect(target, verified.uid, code, verified.codeVerifier);
  }

  private async connect(
    target: OAuthTarget,
    userId: number,
    code: string,
    codeVerifier: string,
  ): Promise<'connected'> {
    const redirectUri = await this.redirectUri(target.key);
    const result = await target.provider.connect({
      code,
      codeVerifier,
      redirectUri,
    });
    try {
      await upsertCalendarConnection(this.db, {
        userId,
        provider: target.key,
        result,
      });
    } catch (err) {
      // Google already issued this grant; nothing will hold it, so end it.
      await revokeUnstoredGrant(target.provider, result.credentials);
      throw err;
    }
    return 'connected';
  }

  /**
   * Never a 500: unexpected errors land on `?error=unavailable`. They still
   * reach Sentry (`scrubSecrets` strips tokens/code/state in beforeSend).
   */
  private failureCode(err: unknown): CalendarOAuthErrorCode {
    const known = knownErrorCode(err);
    if (known) return known;
    Sentry.captureException(err);
    this.logger.error(
      `calendar oauth callback failed unexpectedly (${errorClass(err)})`,
    );
    return 'unavailable';
  }

  /** Only OAuth providers with a registered adapter resolve (L12). */
  private resolve(raw: string): OAuthTarget | null {
    if (!Object.prototype.hasOwnProperty.call(LINK_KEYS, raw)) return null;
    const key = raw as CalendarOAuthProvider;
    const link = LINK_KEYS[key];
    const provider = this.registry.getAccountProvider(key);
    return link && provider ? { key, link, provider } : null;
  }

  private async redirectUri(key: CalendarOAuthProvider): Promise<string> {
    return (await buildRedirectUris(this.settings))[key];
  }
}
