import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_navigate_channel';
export const TOOL_DESCRIPTION =
  'Navigate to a specific Discord channel by ID.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    guildId: {
      type: 'string',
      description: 'Guild (server) ID',
    },
    channelId: {
      type: 'string',
      description: 'Channel ID to navigate to',
    },
  },
  required: ['guildId', 'channelId'],
};

const SNOWFLAKE_RE = /^\d{17,20}$/;

export async function execute(params: {
  guildId: string;
  channelId: string;
}): Promise<{ success: boolean; url: string; error?: string }> {
  if (!SNOWFLAKE_RE.test(params.guildId) || !SNOWFLAKE_RE.test(params.channelId)) {
    return { success: false, url: '', error: 'Invalid guild or channel ID — must be a Discord snowflake (17-20 digit number)' };
  }

  const page = await getPage();
  const url = `https://discord.com/channels/${params.guildId}/${params.channelId}`;

  // Discord is a SPA — we need to use the internal router.
  // Option 1: Direct navigation (works in both Electron and browser)
  await page.evaluate((targetUrl: string) => {
    window.location.href = targetUrl;
  }, url);

  // Wait for channel content to load
  await page.waitForTimeout(2000);

  return { success: true, url: page.url() };
}
