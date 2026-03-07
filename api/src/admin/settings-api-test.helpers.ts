/**
 * API credential test helpers for admin settings controller.
 * Extracted from settings.controller.ts for file size compliance.
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('AdminSettingsApiTest');

interface TestResult {
  success: boolean;
  message: string;
}

/** Test IGDB credentials by fetching a Twitch OAuth token. */
export async function testIgdbCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<TestResult> {
  return testOAuthToken(
    'https://id.twitch.tv/oauth2/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'client_credentials',
      }),
    },
    'IGDB',
    'Credentials verified! IGDB / Twitch API is ready.',
    'Twitch API',
  );
}

/** Test Blizzard credentials by fetching an OAuth token. */
export async function testBlizzardCredentials(config: {
  clientId: string;
  clientSecret: string;
}): Promise<TestResult> {
  try {
    const response = await fetch('https://us.battle.net/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`Blizzard test failed: ${response.status} ${errorText}`);
      return { success: false, message: 'Invalid Client ID or Client Secret' };
    }

    return {
      success: true,
      message: 'Credentials verified! Blizzard API is ready.',
    };
  } catch (error) {
    logger.error('Failed to test Blizzard credentials:', error);
    return {
      success: false,
      message: 'Failed to connect to Blizzard API. Please check your network.',
    };
  }
}

/** Shared OAuth token test with error handling. */
async function testOAuthToken(
  url: string,
  init: RequestInit,
  label: string,
  successMsg: string,
  apiName: string,
): Promise<TestResult> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = await response.text();
      logger.warn(`${label} test failed: ${response.status} ${errorText}`);
      return { success: false, message: 'Invalid Client ID or Client Secret' };
    }
    return { success: true, message: successMsg };
  } catch (error) {
    logger.error(`Failed to test ${label} credentials:`, error);
    return {
      success: false,
      message: `Failed to connect to ${apiName}. Please check your network.`,
    };
  }
}

/** Test Steam API key by calling GetSupportedAPIList. */
export async function testSteamApiKey(apiKey: string): Promise<TestResult> {
  try {
    const response = await fetch(
      `https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/?key=${encodeURIComponent(apiKey)}`,
    );

    if (!response.ok) {
      if (response.status === 403) {
        return { success: false, message: 'Invalid Steam API key' };
      }
      return {
        success: false,
        message: `Steam API returned HTTP ${response.status}`,
      };
    }

    return { success: true, message: 'Steam API key is valid!' };
  } catch (error) {
    logger.error('Failed to test Steam API key:', error);
    return {
      success: false,
      message: 'Failed to connect to Steam API. Please check your network.',
    };
  }
}
