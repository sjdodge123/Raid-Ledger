import { registerCanary } from './canary-runner.js';

registerCanary({
  integrationKey: 'blizzard-api',
  name: 'Blizzard',
  requiredEnvVars: [
    'CANARY_BLIZZARD_CLIENT_ID',
    'CANARY_BLIZZARD_CLIENT_SECRET',
  ],
  probe: async () => {
    const clientId = process.env.CANARY_BLIZZARD_CLIENT_ID!;
    const clientSecret = process.env.CANARY_BLIZZARD_CLIENT_SECRET!;

    // Step 1: Battle.net OAuth token exchange
    const tokenResponse = await fetch('https://us.battle.net/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '');
      return {
        status: 'FAIL',
        reason: `Battle.net OAuth failed: HTTP ${tokenResponse.status}`,
        details: text,
      };
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    // Step 2: Fetch realm list (minimal API call to verify token works)
    const realmResponse = await fetch(
      `https://us.api.blizzard.com/data/wow/realm/index?namespace=dynamic-us&locale=en_US&access_token=${tokenData.access_token}`,
      { signal: AbortSignal.timeout(10_000) },
    );

    if (!realmResponse.ok) {
      const text = await realmResponse.text().catch(() => '');
      return {
        status: 'FAIL',
        reason: `Blizzard Realm API failed: HTTP ${realmResponse.status}`,
        details: text,
      };
    }

    return { status: 'PASS' };
  },
});
