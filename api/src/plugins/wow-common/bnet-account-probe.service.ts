/**
 * ROK-2129 L2: the DEMO_MODE Battle.net account-link probe (spec D2–D10).
 * `start` mints the signed state + PKCE challenge + browser-binding cookie;
 * `handleCallback` verifies it, re-proves the admin from the DB, runs the
 * probe and persists a keys-only result. Never logs a token, code or state.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { BnetProbeResultSchema } from '@raid-ledger/contract';
import type {
  BnetProbeErrorCode,
  BnetProbeRegion,
  BnetProbeResult,
  BnetProbeStateDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { getClientUrl } from '../../settings/settings-bot.helpers';
import { BlizzardAuthService } from './blizzard-auth.service';
import { getForeverNamespacePrefix } from './forever-namespace.resolver';
import { WOW_FOREVER_BNET_PROBE_LAST_RESULT_KEY } from './forever.settings';
import {
  bnetProbeReturnLocation,
  buildAuthorizeUrl,
  buildBnetProbeRedirectUri,
  type BnetFetch,
} from './bnet-account-probe.oauth';
import {
  BNET_PROBE_RUN_BUDGET_MS,
  bnetProbeErrorResult,
  runBnetProbe,
  type BnetProbeRunDeps,
} from './bnet-account-probe.run';
import {
  startBnetProbeState,
  verifyBnetProbeState,
  type VerifiedBnetProbeState,
} from './bnet-account-probe.state';

type Db = PostgresJsDatabase<typeof schema>;

/** Live binding to the global fetch, so specs can spy on `globalThis.fetch`. */
const globalFetch: BnetFetch = (url, init) => fetch(url, init);

/** The callback's inputs: raw query + the `rl_bnet_probe_r` cookie value. */
export interface BnetProbeCallbackInput {
  query: Record<string, unknown>;
  cookieHash: string | undefined;
}

function firstString(value: unknown): string | undefined {
  const v: unknown = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

@Injectable()
export class BnetAccountProbeService {
  private readonly logger = new Logger(BnetAccountProbeService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly auth: BlizzardAuthService,
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
  ) {}

  /** The registered-callback URL to show the admin, plus the last result. */
  async getState(): Promise<BnetProbeStateDto> {
    return { redirectUri: await this.redirectUri(), result: await this.read() };
  }

  /** Mint the consent URL and the binding cookie value (400 if unconfigured). */
  async start(
    uid: number,
    region: BnetProbeRegion,
  ): Promise<{ url: string; cookieValue: string }> {
    const config = await this.settings.getBlizzardConfig();
    if (!config) {
      throw new BadRequestException('Blizzard API credentials not configured');
    }
    const minted = startBnetProbeState({ uid, region });
    const url = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: await this.redirectUri(),
      state: minted.state,
      codeChallenge: minted.codeChallenge,
    });
    return { url, cookieValue: minted.bindingCookieValue };
  }

  /** Verify + run + persist; always resolves to the admin-page 302 target. */
  async handleCallback(input: BnetProbeCallbackInput): Promise<string> {
    const code = await this.complete(input).catch((err: unknown) =>
      this.unexpected(err),
    );
    if (code !== null) {
      this.logger.warn(`bnet account probe callback failed (${code})`);
    }
    // A settings read failing here must not 500 the public route (D6): a
    // relative Location lands on the same public origin behind nginx.
    const clientUrl = await getClientUrl(this.settings).catch(() => '');
    return bnetProbeReturnLocation(clientUrl, code);
  }

  private async complete(
    input: BnetProbeCallbackInput,
  ): Promise<BnetProbeErrorCode | null> {
    const state = firstString(input.query.state);
    if (!state) return 'state';
    const verified = await verifyBnetProbeState(this.db, state, {
      cookieHash: input.cookieHash,
    });
    if (!verified || !(await this.isAdmin(verified.uid))) return 'state';
    const providerError = firstString(input.query.error);
    if (providerError) {
      const code = providerError === 'access_denied' ? 'denied' : 'exchange';
      return this.record(
        bnetProbeErrorResult(this.now(), verified.region, code),
      );
    }
    const authCode = firstString(input.query.code);
    if (!authCode) return 'state';
    return this.execute(verified, authCode);
  }

  private async execute(
    verified: VerifiedBnetProbeState,
    code: string,
  ): Promise<BnetProbeErrorCode | null> {
    const { region } = verified;
    const config = await this.settings.getBlizzardConfig();
    if (!config) {
      return this.record(
        bnetProbeErrorResult(this.now(), region, 'unavailable'),
      );
    }
    const deps: BnetProbeRunDeps = {
      fetchFn: globalFetch,
      getAppToken: (r) => this.auth.getAccessToken(r),
      foreverPrefix: getForeverNamespacePrefix(),
      signal: AbortSignal.timeout(BNET_PROBE_RUN_BUDGET_MS),
    };
    const result = await runBnetProbe(deps, {
      at: this.now(),
      region,
      code,
      codeVerifier: verified.codeVerifier,
      redirectUri: await this.redirectUri(),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    return this.record(result);
  }

  /** Re-prove the admin claim from the DB — the callback carries no JWT (D6). */
  private async isAdmin(uid: number): Promise<boolean> {
    const rows = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, uid))
      .limit(1);
    return rows[0]?.role === 'admin';
  }

  /** Persist (schema-checked) and hand back the result's error code. */
  private async record(
    result: BnetProbeResult,
  ): Promise<BnetProbeErrorCode | null> {
    const parsed = BnetProbeResultSchema.parse(result);
    await this.settings.set(
      WOW_FOREVER_BNET_PROBE_LAST_RESULT_KEY,
      JSON.stringify(parsed),
    );
    return parsed.error;
  }

  /** Sentry gets the error's class name only — never a message or extras. */
  private unexpected(err: unknown): BnetProbeErrorCode {
    const kind = err instanceof Error ? err.name : typeof err;
    Sentry.captureException(new Error(`bnet account probe failed: ${kind}`));
    return 'unavailable';
  }

  private async read(): Promise<BnetProbeResult | null> {
    const raw = await this.settings.get(WOW_FOREVER_BNET_PROBE_LAST_RESULT_KEY);
    if (!raw) return null;
    try {
      const parsed = BnetProbeResultSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async redirectUri(): Promise<string> {
    return buildBnetProbeRedirectUri(
      await getClientUrl(this.settings),
      process.env.DISCORD_CALLBACK_URL,
    );
  }

  private now(): string {
    return new Date().toISOString();
  }
}
