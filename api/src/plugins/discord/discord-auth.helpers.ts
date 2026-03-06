/**
 * Discord auth controller helpers.
 * Extracted from discord-auth.controller.ts for file size compliance (ROK-711).
 */
import { Logger, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import * as crypto from 'crypto';
import type { Response, Request } from 'express';

/**
 * Custom DiscordAuthGuard that catches OAuth errors (e.g. InternalOAuthError
 * from passport-oauth2) and redirects to the login page instead of returning
 * a raw JSON 401 response. (ROK-668)
 */
export class DiscordAuthGuard extends AuthGuard('discord') {
  private readonly guardLogger = new Logger('DiscordAuthGuard');

  /** Handle authentication result, redirecting on failure. */
  handleRequest<TUser>(
    err: Error | null,
    user: TUser | false,
    info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      const errorMessage = err?.message || 'Unknown OAuth error';
      const errorName = err?.constructor?.name || 'UnknownError';
      this.guardLogger.warn(
        `Discord OAuth callback failed: [${errorName}] ${errorMessage}`,
      );

      const httpCtx = context.switchToHttp();
      const req = httpCtx.getRequest<Request>();
      const res = httpCtx.getResponse<Response>();
      const clientUrl =
        process.env.CLIENT_URL ||
        `${(req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http'}://${req.headers.host || 'localhost'}`;
      res.redirect(`${clientUrl}/login?error=oauth_failed`);
      return undefined as unknown as TUser;
    }
    return user;
  }
}

/** Sign OAuth state parameter to prevent tampering. */
export function signOAuthState(payload: object, secret: string): string {
  const data = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('hex');
  return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
}

/** Verify and decode signed OAuth state parameter. */
export function verifyOAuthState(
  state: string,
  secret: string,
  logger: Logger,
): Record<string, unknown> | null {
  try {
    const { data, signature } = JSON.parse(
      Buffer.from(state, 'base64').toString(),
    ) as { data: string; signature: string };
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('hex');
    if (
      !crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      )
    )
      return null;

    const parsed = JSON.parse(data) as Record<string, unknown>;
    const MAX_STATE_AGE_MS = 10 * 60 * 1000;
    const timestamp = parsed.timestamp as number | undefined;
    if (!timestamp || Date.now() - timestamp > MAX_STATE_AGE_MS) {
      logger.warn('OAuth state parameter expired');
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Derive the external origin from request headers. */
export function getOriginUrl(req: Request): string {
  const proto =
    (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
    req.protocol ||
    'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

/** Exchange Discord OAuth code for access token. */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  discordFetch: typeof fetch,
): Promise<{ access_token: string }> {
  const tokenResponse = await discordFetch(
    'https://discord.com/api/oauth2/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    },
  );
  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(
      `Discord token exchange failed: ${tokenResponse.status} ${errorBody}`,
    );
  }
  return (await tokenResponse.json()) as { access_token: string };
}

/** Fetch Discord user profile with access token. */
export async function fetchDiscordProfile(
  accessToken: string,
  discordFetch: typeof fetch,
): Promise<{ id: string; username: string; avatar?: string }> {
  const userResponse = await discordFetch('https://discord.com/api/users/@me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent':
        'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)',
    },
  });
  if (!userResponse.ok) throw new Error('Failed to fetch Discord profile');
  return (await userResponse.json()) as {
    id: string;
    username: string;
    avatar?: string;
  };
}
