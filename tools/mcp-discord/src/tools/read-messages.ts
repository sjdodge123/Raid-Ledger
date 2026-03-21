import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_read_messages';
export const TOOL_DESCRIPTION =
  'Read messages visible in the current Discord channel by scraping the DOM.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    count: {
      type: 'number',
      description: 'Max messages to return (default: 10)',
    },
  },
};

interface ScrapedMessage {
  author: string;
  content: string;
  hasEmbed: boolean;
  embedTitle: string | null;
  embedDescription: string | null;
  buttons: string[];
}

export async function execute(params: {
  count?: number;
}): Promise<{ messages: ScrapedMessage[] }> {
  const page = await getPage();
  const limit = params.count ?? 10;

  // Discord's message list uses role="list" with role="listitem" children.
  // Class names are hashed, so we use ARIA roles and data attributes.
  const messages = await page.evaluate((maxCount: number) => {
    const results: ScrapedMessage[] = [];

    // Try multiple selector strategies — Discord DOM changes frequently.
    // querySelectorAll always returns a NodeList (never null), so check .length for fallback.
    let messageEls = document.querySelectorAll('[id^="chat-messages-"]');
    if (messageEls.length === 0) messageEls = document.querySelectorAll('[class*="messageListItem"]');
    if (messageEls.length === 0) messageEls = document.querySelectorAll('[role="listitem"]');

    const els = Array.from(messageEls).slice(-maxCount);

    for (const el of els) {
      // Author — usually in an element with class containing "username"
      const authorEl = el.querySelector(
        '[class*="username"], [class*="headerText"] span',
      );

      // Content — message body
      const contentEl = el.querySelector(
        '[id^="message-content-"], [class*="messageContent"]',
      );

      // Embed detection
      const embedEl = el.querySelector('[class*="embedWrapper"]');
      const embedTitleEl = embedEl?.querySelector(
        '[class*="embedTitle"], [class*="embed-title"]',
      );
      const embedDescEl = embedEl?.querySelector(
        '[class*="embedDescription"], [class*="embed-description"]',
      );

      // Buttons
      const buttonEls = el.querySelectorAll(
        '[class*="buttonContent"], button[class*="component"]',
      );
      const buttons = Array.from(buttonEls).map(
        (b) => b.textContent?.trim() ?? '',
      );

      results.push({
        author: authorEl?.textContent?.trim() ?? 'unknown',
        content: contentEl?.textContent?.trim() ?? '',
        hasEmbed: !!embedEl,
        embedTitle: embedTitleEl?.textContent?.trim() ?? null,
        embedDescription: embedDescEl?.textContent?.trim() ?? null,
        buttons: buttons.filter(Boolean),
      });
    }
    return results;
  }, limit);

  return { messages };
}
