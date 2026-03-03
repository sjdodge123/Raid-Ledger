import { registerCanary } from './canary-runner.js';

registerCanary({
  integrationKey: 'igdb',
  name: 'IGDB (Twitch)',
  requiredEnvVars: ['CANARY_IGDB_CLIENT_ID', 'CANARY_IGDB_CLIENT_SECRET'],
  probe: async () => {
    const clientId = process.env.CANARY_IGDB_CLIENT_ID!;
    const clientSecret = process.env.CANARY_IGDB_CLIENT_SECRET!;

    // Step 1: Twitch OAuth token exchange
    const tokenResponse = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text().catch(() => '');
      return {
        status: 'FAIL',
        reason: `Twitch OAuth failed: HTTP ${tokenResponse.status}`,
        details: text,
      };
    }

    const tokenData = (await tokenResponse.json()) as { access_token: string };

    // Step 2: IGDB game search (minimal query)
    const igdbResponse = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'text/plain',
      },
      body: 'fields name; limit 1;',
      signal: AbortSignal.timeout(10_000),
    });

    if (!igdbResponse.ok) {
      const text = await igdbResponse.text().catch(() => '');
      return {
        status: 'FAIL',
        reason: `IGDB API failed: HTTP ${igdbResponse.status}`,
        details: text,
      };
    }

    return { status: 'PASS' };
  },
});
