import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_screenshot';
export const TOOL_DESCRIPTION =
  'Take a screenshot of the current Discord view. Returns base64 PNG.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    selector: {
      type: 'string',
      description: 'CSS selector to screenshot a specific element (optional)',
    },
    fullPage: {
      type: 'boolean',
      description: 'Capture full page instead of viewport (default: false)',
    },
  },
};

export async function execute(params: {
  selector?: string;
  fullPage?: boolean;
}): Promise<{ base64: string }> {
  const page = await getPage();

  let screenshot: Buffer;
  if (params.selector) {
    const el = page.locator(params.selector).first();
    screenshot = await el.screenshot({ type: 'png' });
  } else {
    screenshot = await page.screenshot({
      type: 'png',
      fullPage: params.fullPage ?? false,
    });
  }

  return { base64: screenshot.toString('base64') };
}
