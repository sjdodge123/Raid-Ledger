import { registerCanary } from './canary-runner.js';

registerCanary({
  integrationKey: 'discord-oauth',
  name: 'Discord',
  requiredEnvVars: ['CANARY_DISCORD_BOT_TOKEN'],
  probe: async () => {
    const token = process.env.CANARY_DISCORD_BOT_TOKEN!;

    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return {
        status: 'FAIL',
        reason: `Discord API returned HTTP ${response.status}`,
        details: text,
      };
    }

    return { status: 'PASS' };
  },
});
