/**
 * OAuth test helpers for admin settings controller.
 * Extracted from settings.controller.ts for file size compliance.
 */
import { Logger } from '@nestjs/common';
import { DiscordOAuthTestSchema } from '@raid-ledger/contract';
import { handleValidationError } from '../common/validation.util';

const logger = new Logger('AdminSettingsOAuth');

interface OAuthTestResponse {
  success: boolean;
  message: string;
  /** ROK-1703: Discord could not be asked (429 / non-JSON) — nothing was verified, try again. */
  retryable?: boolean;
}

/** ROK-1703: a typed pair Discord could not check is unverified, never accepted. */
const TYPED_PAIR_UNCHECKED: OAuthTestResponse = {
  success: false,
  retryable: true,
  message:
    "Discord is busy and couldn't check the ID and secret right now. Try again in a moment.",
};

/** The pair under test; the callback URL plays no part in the check. */
interface OAuthPair {
  clientId: string;
  clientSecret: string;
}

/** `saved` = the stored pair; `typed` = a pair sent in the request body. */
export type OAuthPairSource = 'saved' | 'typed';

const DISCORD_HEADERS = {
  'User-Agent': 'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)',
};

/**
 * ROK-1703 D-5: an empty body means "test the saved pair" (null); otherwise
 * the body must be a valid `{ clientId, clientSecret }` (400 if not). The
 * Zod issues name the field and rule only, never the submitted value.
 */
export function parseOAuthTestBody(body: unknown): OAuthPair | null {
  if (body === undefined || body === null) return null;
  if (typeof body === 'object' && Object.keys(body).length === 0) return null;
  try {
    return DiscordOAuthTestSchema.parse(body);
  } catch (error) {
    handleValidationError(error);
  }
}

/** Test Discord OAuth credentials via token endpoint with gateway fallback. */
export async function testDiscordOAuth(
  config: OAuthPair,
  source: OAuthPairSource = 'saved',
): Promise<OAuthTestResponse> {
  try {
    const tokenResult = await testTokenEndpoint(config);
    if (tokenResult) return tokenResult;

    // Token endpoint blocked. Gateway reachability proves nothing about a
    // typed pair, so the wizard gets an unverified answer, never a success.
    if (source === 'typed') return TYPED_PAIR_UNCHECKED;
    return testGatewayFallback();
  } catch (error) {
    logger.error('Failed to test Discord OAuth:', error);
    return {
      success: false,
      message: 'Failed to connect to Discord API. Please check your network.',
    };
  }
}

/** Attempt token endpoint to validate credentials. Returns null if rate-limited. */
async function testTokenEndpoint(
  config: OAuthPair,
): Promise<OAuthTestResponse | null> {
  const basicAuth = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString('base64');

  const tokenResponse = await fetchDiscordToken(basicAuth);
  const tokenData = await parseTokenResponse(tokenResponse);
  if (!tokenData) return null;

  return interpretTokenResult(
    tokenResponse.status,
    tokenResponse.ok,
    tokenData,
  );
}

/** POST to Discord token endpoint. */
async function fetchDiscordToken(basicAuth: string) {
  return fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: {
      ...DISCORD_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'identify',
    }),
  });
}

/** Parse token response; returns null and logs if non-JSON or rate-limited. */
async function parseTokenResponse(
  response: Response,
): Promise<{ error?: string } | null> {
  const tokenText = await response.text();
  try {
    return JSON.parse(tokenText) as { error?: string };
  } catch {
    logger.warn(
      `Token endpoint blocked (${response.status}), falling back to gateway check`,
    );
    return null;
  }
}

/** Interpret the parsed token endpoint result. */
function interpretTokenResult(
  status: number,
  ok: boolean,
  data: { error?: string },
): OAuthTestResponse | null {
  if (status === 401 || data.error === 'invalid_client')
    return { success: false, message: 'Invalid Client ID or Client Secret' };
  if (status === 400 && data.error === 'unsupported_grant_type')
    return {
      success: true,
      message: 'Credentials are valid! Discord OAuth is ready to use.',
    };
  if (ok)
    return { success: true, message: 'Credentials verified successfully!' };
  if (status === 429) {
    logger.warn(
      `Token endpoint blocked (${status}), falling back to gateway check`,
    );
    return null;
  }
  return {
    success: false,
    message: `Discord returned an error: ${data.error || status}`,
  };
}

/** Lightweight gateway check to confirm Discord API reachability. */
async function testGatewayFallback(): Promise<OAuthTestResponse> {
  const gatewayResponse = await fetch('https://discord.com/api/v10/gateway', {
    headers: DISCORD_HEADERS,
  });

  if (gatewayResponse.ok) {
    return {
      success: true,
      message:
        'Discord API is reachable. Credentials are saved — they will be validated on first login.',
    };
  }

  return {
    success: false,
    message: `Discord API is unreachable (HTTP ${gatewayResponse.status}). The server's IP may be blocked by Cloudflare.`,
  };
}
