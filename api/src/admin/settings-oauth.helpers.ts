/**
 * OAuth test helpers for admin settings controller.
 * Extracted from settings.controller.ts for file size compliance.
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('AdminSettingsOAuth');

interface OAuthTestResponse {
  success: boolean;
  message: string;
}

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

const DISCORD_HEADERS = {
  'User-Agent': 'RaidLedger (https://github.com/sjdodge123/Raid-Ledger, 1.0)',
};

/** Test Discord OAuth credentials via token endpoint with gateway fallback. */
export async function testDiscordOAuth(
  config: OAuthConfig,
): Promise<OAuthTestResponse> {
  try {
    const tokenResult = await testTokenEndpoint(config);
    if (tokenResult) return tokenResult;

    // Token endpoint blocked — fall back to gateway check
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
  config: OAuthConfig,
): Promise<OAuthTestResponse | null> {
  const basicAuth = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
  ).toString('base64');

  const tokenResponse = await fetch(
    'https://discord.com/api/v10/oauth2/token',
    {
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
    },
  );

  const tokenText = await tokenResponse.text();
  let tokenData: { error?: string } | null = null;
  try {
    tokenData = JSON.parse(tokenText) as { error?: string };
  } catch {
    // Non-JSON response — likely Cloudflare HTML block
  }

  if (!tokenData) {
    // Non-JSON response, fall through to gateway
    logger.warn(
      `Token endpoint blocked (${tokenResponse.status}), falling back to gateway check`,
    );
    return null;
  }

  if (tokenResponse.status === 401 || tokenData.error === 'invalid_client') {
    return { success: false, message: 'Invalid Client ID or Client Secret' };
  }

  if (
    tokenResponse.status === 400 &&
    tokenData.error === 'unsupported_grant_type'
  ) {
    return {
      success: true,
      message: 'Credentials are valid! Discord OAuth is ready to use.',
    };
  }

  if (tokenResponse.ok) {
    return { success: true, message: 'Credentials verified successfully!' };
  }

  if (tokenResponse.status === 429) {
    // Rate-limited — fall through to gateway
    logger.warn(
      `Token endpoint blocked (${tokenResponse.status}), falling back to gateway check`,
    );
    return null;
  }

  return {
    success: false,
    message: `Discord returned an error: ${tokenData.error || tokenResponse.status}`,
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
