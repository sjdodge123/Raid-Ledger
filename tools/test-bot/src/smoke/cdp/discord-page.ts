/**
 * CDP helpers for interacting with Discord Electron via Playwright.
 *
 * Requires Discord launched with --remote-debugging-port=9222.
 * Gated behind DISCORD_CDP=true in the test runner.
 */

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

/** Navigate to a specific text channel in a guild. */
export async function navigateToChannel(
  page: import('playwright').Page,
  guildId: string,
  channelId: string,
): Promise<void> {
  const url = `https://discord.com/channels/${guildId}/${channelId}`;
  await page.evaluate((targetUrl) => {
    window.location.href = targetUrl;
  }, url);
  await page.waitForTimeout(3000);
}

/** Count ephemeral messages by counting "Dismiss message" links. */
async function countEphemeralMessages(
  page: import('playwright').Page,
): Promise<number> {
  return page.locator('text=Dismiss message').count();
}

/** Wait for a new ephemeral message to appear after a command. */
export async function readEphemeralResponse(
  page: import('playwright').Page,
  timeoutMs = 15_000,
  prevCount = 0,
): Promise<{ content: string; hasEmbed: boolean; embedTitle: string | null }> {
  const deadline = Date.now() + timeoutMs;
  // Poll until a new ephemeral message appears
  while (Date.now() < deadline) {
    const currentCount = await countEphemeralMessages(page);
    if (currentCount > prevCount) break;
    await page.waitForTimeout(500);
  }
  // Read the last message in the chat
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

/** Dismiss all ephemeral messages to clear the chat for the next command. */
export async function dismissEphemeralMessages(
  page: import('playwright').Page,
): Promise<void> {
  // Click all "Dismiss message" links
  const links = page.locator('text=Dismiss message');
  const count = await links.count();
  for (let i = count - 1; i >= 0; i--) {
    await links.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** Type a slash command into Discord's chat input. */
export async function typeSlashCommand(
  page: import('playwright').Page,
  commandName: string,
): Promise<{ prevEphemeralCount: number }> {
  const prevCount = await countEphemeralMessages(page);
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
      // Clear any leftover text
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
      // Type the slash command
      await page.keyboard.type(`/${commandName}`, { delay: 50 });
      // Wait for Discord autocomplete to appear
      await page.waitForTimeout(1500);
      // Press Enter to select the autocomplete option and submit
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      return { prevEphemeralCount: prevCount };
    }
  }
  throw new Error('Could not find Discord chat input');
}
