import { getPage } from '../cdp.js';

export const TOOL_NAME = 'discord_verify_embed';
export const TOOL_DESCRIPTION =
  'Verify embed content in the most recent bot message. Returns structured embed data and a screenshot.';
export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    messageIndex: {
      type: 'number',
      description:
        'Index from the bottom (0 = most recent). Default: 0',
    },
  },
};

interface EmbedData {
  title: string | null;
  description: string | null;
  color: string | null;
  fields: { name: string; value: string }[];
  footer: string | null;
}

export async function execute(params: {
  messageIndex?: number;
}): Promise<{ embed: EmbedData | null; screenshot: string }> {
  const page = await getPage();
  const index = params.messageIndex ?? 0;

  const embed = await page.evaluate((idx: number) => {
    const embeds = document.querySelectorAll('[class*="embedWrapper"]');
    const el = embeds[embeds.length - 1 - idx];
    if (!el) return null;

    const title =
      el.querySelector('[class*="embedTitle"]')?.textContent?.trim() ?? null;
    const description =
      el
        .querySelector('[class*="embedDescription"]')
        ?.textContent?.trim() ?? null;

    // Color is usually in a left border style
    const colorBar = el.querySelector('[class*="embedPill"], [class*="leftBorder"]');
    const color = colorBar
      ? getComputedStyle(colorBar).backgroundColor
      : null;

    const fieldEls = el.querySelectorAll('[class*="embedField"]');
    const fields = Array.from(fieldEls).map((f) => ({
      name:
        f.querySelector('[class*="embedFieldName"]')?.textContent?.trim() ??
        '',
      value:
        f.querySelector('[class*="embedFieldValue"]')?.textContent?.trim() ??
        '',
    }));

    const footer =
      el.querySelector('[class*="embedFooter"]')?.textContent?.trim() ?? null;

    return { title, description, color, fields, footer };
  }, index);

  // Screenshot the embed if found
  let screenshot = '';
  const embedEls = page.locator('[class*="embedWrapper"]');
  const count = await embedEls.count();
  if (count > index) {
    const targetEl = embedEls.nth(count - 1 - index);
    const buf = await targetEl.screenshot({ type: 'png' });
    screenshot = buf.toString('base64');
  }

  return { embed, screenshot };
}
