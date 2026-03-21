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
        'Message index from the bottom (0 = most recent). Default: 0',
    },
  },
  required: ['buttonLabel'],
};

export async function execute(params: {
  buttonLabel: string;
  messageIndex?: number;
}): Promise<{ success: boolean; error?: string }> {
  const page = await getPage();

  try {
    // Find buttons with matching text, searching from bottom of chat
    const button = page
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
