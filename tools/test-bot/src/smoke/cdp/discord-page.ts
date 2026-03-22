/**
 * CDP helpers for interacting with Discord Electron via Playwright.
 *
 * Requires Discord launched with --remote-debugging-port=9222.
 * Gated behind DISCORD_CDP=true in the test runner.
 */

// Playwright is imported dynamically since it's not a direct dependency
// of test-bot. It's available from the root workspace.

interface DiscordPageResult {
  browser: unknown;
  page: unknown;
}

const CDP_URL = 'http://localhost:9222';

/** Connect to Discord Electron via CDP and find the main page. */
export async function connectDiscordCDP(): Promise<DiscordPageResult> {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(CDP_URL, {
    timeout: 10_000,
  });
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser contexts — Discord may not expose CDP');
  }
  const pages = contexts[0].pages();
  const page =
    pages.find((p) => p.url().includes('discord.com')) ??
    pages.find((p) => p.url().includes('discordapp.com')) ??
    pages[0];
  if (!page) throw new Error('No Discord page found');
  return { browser, page };
}

/** Read the last ephemeral message content from the Discord chat. */
export async function readEphemeralResponse(
  page: import('playwright').Page,
  timeoutMs = 10_000,
): Promise<{ content: string; hasEmbed: boolean; embedTitle: string | null }> {
  // Wait for a message to appear using fallback selectors
  const selectors = [
    '[id^="chat-messages-"]',
    '[class*="messageListItem"]',
    '[role="listitem"]',
  ];
  let found = false;
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: timeoutMs });
      found = true;
      break;
    } catch {
      continue;
    }
  }
  if (!found) throw new Error('No messages appeared in Discord UI');

  return page.evaluate(() => {
    let msgEls = document.querySelectorAll('[id^="chat-messages-"]');
    if (msgEls.length === 0)
      msgEls = document.querySelectorAll('[class*="messageListItem"]');
    if (msgEls.length === 0)
      msgEls = document.querySelectorAll('[role="listitem"]');
    const last = msgEls[msgEls.length - 1];
    if (!last) return { content: '', hasEmbed: false, embedTitle: null };
    const contentEl = last.querySelector(
      '[id^="message-content-"], [class*="messageContent"]',
    );
    const embedEl = last.querySelector('[class*="embedWrapper"]');
    const embedTitleEl = embedEl?.querySelector(
      '[class*="embedTitle"], [class*="embed-title"]',
    );
    return {
      content: contentEl?.textContent?.trim() ?? '',
      hasEmbed: !!embedEl,
      embedTitle: embedTitleEl?.textContent?.trim() ?? null,
    };
  });
}

/** Type a slash command into Discord's chat input. */
export async function typeSlashCommand(
  page: import('playwright').Page,
  commandName: string,
  _options?: Record<string, string>,
): Promise<void> {
  // Focus the chat input using fallback selectors
  const inputSelectors = [
    '[role="textbox"][data-slate-editor="true"]',
    '[class*="slateTextArea"]',
    'div[contenteditable="true"]',
  ];
  for (const sel of inputSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click();
      await page.keyboard.type(`/${commandName}`, { delay: 50 });
      // Wait for Discord autocomplete to appear, then press Enter
      await page.waitForTimeout(1000);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      return;
    }
  }
  throw new Error('Could not find Discord chat input');
}
