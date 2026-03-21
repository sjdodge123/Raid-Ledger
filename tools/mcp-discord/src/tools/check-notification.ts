import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_check_notification';
export const TOOL_DESCRIPTION =
  'Check DMs or notifications for a message containing specific text.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    contains: {
      type: 'string',
      description: 'Text to search for in recent DMs/notifications',
    },
  },
  required: ['contains'],
};

interface NotificationResult {
  found: boolean;
  message?: {
    author: string;
    content: string;
  };
}

export async function execute(params: {
  contains: string;
}): Promise<NotificationResult> {
  const page = await getPage();

  // Navigate to DMs by clicking the DM icon in the sidebar
  const dmButton = page.locator(
    '[aria-label="Direct Messages"], [class*="privateChannels"]',
  );
  if ((await dmButton.count()) > 0) {
    await dmButton.first().click();
    await page.waitForTimeout(1500);
  }

  // Search visible messages for the text
  const result = await page.evaluate((searchText: string) => {
    const messages = document.querySelectorAll(
      '[id^="chat-messages-"], [class*="messageContent"]',
    );

    for (const msg of messages) {
      const content = msg.textContent?.trim() ?? '';
      if (content.includes(searchText)) {
        const container = msg.closest('[class*="messageListItem"], [role="listitem"]');
        const author =
          container
            ?.querySelector('[class*="username"]')
            ?.textContent?.trim() ?? 'unknown';
        return { found: true, message: { author, content } };
      }
    }
    return { found: false };
  }, params.contains);

  return result;
}
