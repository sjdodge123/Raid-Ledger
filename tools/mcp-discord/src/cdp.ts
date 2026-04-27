import { chromium, type Browser, type Page } from 'playwright';
import { CDP_URL } from './config.js';

let browser: Browser | null = null;
let page: Page | null = null;

export class CdpUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CdpUnreachableError';
  }
}

/**
 * Connect to Discord Electron via CDP.
 *
 * Requires Discord to be launched with --remote-debugging-port=9222:
 *   /Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9222
 */
export async function connectCDP(): Promise<Page> {
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 10_000 });
    console.error('[mcp-discord] Connected to CDP');
  } catch (err) {
    throw new CdpUnreachableError(
      `Failed to connect to Discord via CDP at ${CDP_URL}. ` +
        'Ensure Discord is running with --remote-debugging-port=9222.\n' +
        `Original error: ${err}`,
    );
  }

  // Discord Electron typically has one main context
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser contexts found — Discord may not expose CDP correctly');
  }

  const pages = contexts[0].pages();
  // Find the main Discord app page (not DevTools or splash)
  page =
    pages.find((p) => p.url().includes('discord.com')) ??
    pages.find((p) => p.url().includes('discordapp.com')) ??
    pages[0];

  if (!page) throw new Error('No Discord page found in CDP contexts');

  console.error(`[mcp-discord] Connected to page: ${page.url()}`);
  return page;
}

export async function getPage(): Promise<Page> {
  if (!page) {
    console.error('[mcp-discord] No CDP connection — attempting lazy reconnect...');
    await connectCDP();
  }
  return page!;
}

export async function disconnectCDP(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
    page = null;
    console.error('[mcp-discord] Disconnected from CDP');
  }
}

/** Check if CDP endpoint is reachable. */
export async function probeCDP(): Promise<{
  reachable: boolean;
  error?: string;
  version?: Record<string, unknown>;
}> {
  try {
    const resp = await fetch(`${CDP_URL}/json/version`);
    const version = (await resp.json()) as Record<string, unknown>;
    return { reachable: true, version };
  } catch (err) {
    return { reachable: false, error: String(err) };
  }
}
