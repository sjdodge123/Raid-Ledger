/**
 * Demo script — run with: npx tsx src/demo.ts
 *
 * Connects the test bot, reads recent messages from the configured channel,
 * and optionally joins voice for 10 seconds.
 */
import { connect, disconnect } from './client.js';
import { readLastMessages } from './helpers/messages.js';
import { joinVoice, leaveVoice, getVoiceMembers } from './helpers/voice.js';
import { TEXT_CHANNEL_ID, VOICE_CHANNEL_ID } from './config.js';

async function main() {
  await connect();

  // Read messages
  if (TEXT_CHANNEL_ID) {
    console.log('\n--- Recent messages ---');
    const msgs = await readLastMessages(TEXT_CHANNEL_ID, 5);
    for (const msg of msgs) {
      console.log(`[${msg.authorTag}] ${msg.content || '(embed/attachment)'}`);
      for (const embed of msg.embeds) {
        console.log(`  Embed: ${embed.title} — ${embed.description?.slice(0, 80)}`);
      }
    }
  }

  // Voice test
  if (VOICE_CHANNEL_ID) {
    console.log('\n--- Voice test ---');
    await joinVoice(VOICE_CHANNEL_ID);
    const members = getVoiceMembers(VOICE_CHANNEL_ID);
    console.log('Voice members:', members.map((m) => m.tag).join(', '));
    console.log('Staying in voice for 10 seconds...');
    await new Promise((r) => setTimeout(r, 10_000));
    leaveVoice();
  }

  await disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
