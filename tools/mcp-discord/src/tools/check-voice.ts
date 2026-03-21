import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_check_voice_members';
export const TOOL_DESCRIPTION =
  'Check which members are in a voice channel by reading the sidebar.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    channelName: {
      type: 'string',
      description: 'Voice channel name to look for in the sidebar',
    },
  },
};

export async function execute(params: {
  channelName?: string;
}): Promise<{ members: string[]; channelName: string | null }> {
  const page = await getPage();

  const result = await page.evaluate((targetChannel: string | undefined) => {
    // Voice channels in the sidebar show connected users beneath them
    const channels = document.querySelectorAll(
      '[class*="channelName"], [data-list-item-id*="channels"]',
    );

    let found: Element | null = null;
    for (const ch of channels) {
      const name = ch.textContent?.trim();
      if (targetChannel && name?.includes(targetChannel)) {
        found = ch;
        break;
      }
    }

    // Look for voice user list items near the channel
    const voiceUsers = document.querySelectorAll(
      '[class*="voiceUser"], [class*="listDefault"] [class*="username"]',
    );

    const members = Array.from(voiceUsers).map(
      (u) => u.textContent?.trim() ?? 'unknown',
    );

    return {
      members,
      channelName: found?.textContent?.trim() ?? null,
    };
  }, params.channelName);

  return result;
}
