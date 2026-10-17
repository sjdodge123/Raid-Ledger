/**
 * CDP probe script — run with: npx tsx src/probe-cdp.ts
 *
 * Tests whether Discord Electron is exposing CDP on the configured port.
 * This is the first spike deliverable: "Verify CDP connection works on macOS"
 */
import { probeCDP, connectCDP, disconnectCDP, getPage } from './cdp.js';

async function main() {
  console.log('=== CDP Probe ===\n');

  // Step 1: Check if CDP endpoint is reachable
  console.log('1. Checking CDP endpoint...');
  const probe = await probeCDP();
  if (!probe.reachable) {
    console.error('  FAIL: CDP not reachable:', probe.error);
    console.log('\n  To launch Discord with CDP:');
    console.log(
      '  /Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9222',
    );
    process.exit(1);
  }
  console.log('  OK: CDP endpoint reachable');
  console.log('  Version info:', JSON.stringify(probe.version, null, 2));

  // Step 2: Connect via Playwright
  console.log('\n2. Connecting via Playwright connectOverCDP...');
  try {
    await connectCDP();
    const page = await getPage();
    console.log('  OK: Connected to page:', page.url());

    // Step 3: Take a screenshot
    console.log('\n3. Taking screenshot...');
    const screenshot = await page.screenshot({ type: 'png' });
    const fs = await import('fs');
    const outPath = '/tmp/discord-cdp-screenshot.png';
    fs.writeFileSync(outPath, screenshot);
    console.log(`  OK: Screenshot saved to ${outPath}`);

    // Step 4: Read page title and basic DOM info
    console.log('\n4. Reading page info...');
    const title = await page.title();
    console.log(`  Title: ${title}`);

    // Try to find message containers
    const messageCount = await page.locator('[class*="message"]').count();
    console.log(`  Elements matching [class*="message"]: ${messageCount}`);

    // Check for Discord-specific elements
    const channelHeader = await page
      .locator('[class*="channelName"], [class*="channel-name"]')
      .first()
      .textContent()
      .catch(() => 'not found');
    console.log(`  Channel header: ${channelHeader}`);
  } catch (err) {
    console.error('  FAIL:', err);
  } finally {
    await disconnectCDP();
  }

  console.log('\n=== Probe complete ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
