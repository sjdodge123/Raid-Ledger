import type { Locator, Page } from 'playwright';
import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_click_button';
export const TOOL_DESCRIPTION =
  'Click a button on a Discord bot message by its label text.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    buttonLabel: {
      type: 'string',
      description: 'The visible text label of the button to click',
    },
    messageIndex: {
      type: 'number',
      description:
        'Message index from the bottom (0 = most recent). Omit to use the ' +
        'most recent message that has a matching button.',
    },
  },
  required: ['buttonLabel'],
};

/**
 * Chat message rows (same strategies as read_messages). Buttons are only ever
 * looked up inside these, so a label can never match Discord's own UI — the
 * server menu, settings, modals — which this tool drives on a real account.
 */
export const MESSAGE_ROW = '[id^="chat-messages-"]';
export const MESSAGE_ROW_FALLBACK = '[class*="messageListItem"]';

/** The chat message rows on screen, oldest first. */
async function messageRows(page: Page): Promise<Locator> {
  const rows = page.locator(MESSAGE_ROW);
  if ((await rows.count()) > 0) return rows;
  return page.locator(MESSAGE_ROW_FALLBACK);
}

/** Resolve the rows to search: one message when messageIndex is set, else all. */
async function scopeRows(
  page: Page,
  messageIndex: number | undefined,
): Promise<Locator | { error: string }> {
  const rows = await messageRows(page);
  if (messageIndex === undefined) return rows;
  if (!Number.isInteger(messageIndex) || messageIndex < 0) {
    return { error: `messageIndex must be a non-negative integer, got ${messageIndex}` };
  }
  const count = await rows.count();
  if (messageIndex >= count) {
    return { error: `Message ${messageIndex} not found (${count} messages on screen)` };
  }
  return rows.nth(count - 1 - messageIndex);
}

export async function execute(params: {
  buttonLabel: string;
  messageIndex?: number | undefined;
}): Promise<{ success: boolean; error?: string }> {
  const page = await getPage();

  try {
    const scope = await scopeRows(page, params.messageIndex);
    if ('error' in scope) return { success: false, error: scope.error };

    // Last matching button inside the scoped message row(s), i.e. nearest the
    // bottom of the chat.
    const button = scope
      .locator('button')
      .filter({ hasText: params.buttonLabel })
      .last();

    const exists = (await button.count()) > 0;
    if (!exists) {
      return {
        success: false,
        error: `Button "${params.buttonLabel}" not found on screen`,
      };
    }

    await button.click();
    await page.waitForTimeout(500); // Brief pause for Discord to process

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}
