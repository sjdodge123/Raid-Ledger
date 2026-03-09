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
    const token = await fetchBlizzardToken(clientId, clientSecret);
    if (token.status === 'FAIL') return token;
    return verifyBlizzardToken((token as { accessToken: string }).accessToken);
  },
});

async function fetchBlizzardToken(clientId: string, clientSecret: string) {
  const resp = await fetch('https://us.battle.net/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      status: 'FAIL' as const,
      reason: `Battle.net OAuth failed: HTTP ${resp.status}`,
      details: text,
    };
  }
  const data = (await resp.json()) as { access_token: string };
  return { status: 'OK' as const, accessToken: data.access_token };
}

async function verifyBlizzardToken(accessToken: string) {
  const resp = await fetch(
    `https://us.api.blizzard.com/data/wow/realm/index?namespace=dynamic-us&locale=en_US`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return {
      status: 'FAIL' as const,
      reason: `Blizzard Realm API failed: HTTP ${resp.status}`,
      details: text,
    };
  }
  return { status: 'PASS' as const };
}
