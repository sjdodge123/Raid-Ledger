import { registerCanary } from './canary-runner.js';

registerCanary({
  integrationKey: 'igdb',
  name: 'IGDB (Twitch)',
  requiredEnvVars: ['CANARY_IGDB_CLIENT_ID', 'CANARY_IGDB_CLIENT_SECRET'],
  probe: async () => {
    const clientId = process.env.CANARY_IGDB_CLIENT_ID!;
    const clientSecret = process.env.CANARY_IGDB_CLIENT_SECRET!;
    const token = await fetchTwitchToken(clientId, clientSecret);
    if (token.status === 'FAIL') return token;
    return verifyIgdbApi(
      clientId,
      (token as { accessToken: string }).accessToken,
    );
  },
});

async function fetchTwitchToken(clientId: string, clientSecret: string) {
  const resp = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      status: 'FAIL' as const,
      reason: `Twitch OAuth failed: HTTP ${resp.status}`,
      details: text,
    };
  }
  const data = (await resp.json()) as { access_token: string };
  return { status: 'OK' as const, accessToken: data.access_token };
}

async function verifyIgdbApi(clientId: string, accessToken: string) {
  const resp = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'text/plain',
    },
    body: 'fields name; limit 1;',
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      status: 'FAIL' as const,
      reason: `IGDB API failed: HTTP ${resp.status}`,
      details: text,
    };
  }
  return { status: 'PASS' as const };
}
