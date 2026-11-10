/**
 * ROK-2153 S2 — the core claim routes (`GET/POST guilds/:id/claim`) against a
 * real database, through a FAKE provider defined here (the hub-ownership scan
 * skips spec files). The fake is owned by Pelican so the inactive-plugin path
 * is real: `afterEach` deactivates Pelican, `beforeEach` re-activates it.
 * Every test builds its own community hub; the providers only `supports` the
 * hub ids registered in their tables, and `afterAll` empties those tables
 * (memory only) so a reused guild id in a later suite is never served.
 * No afterAll DB work: the shared setup closes the pool.
 */
import { eq } from 'drizzle-orm';
import {
  HubClaimResultSchema,
  HubClaimStatusSchema,
  type HubClaimCandidate,
  type HubClaimResult,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { loginAsAdmin } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import * as schema from '../../drizzle/schema';
import {
  EXTENSION_POINTS,
  type HubClaimContext,
  type HubClaimHubRef,
  type HubClaimProvider,
  type HubClaimProviderStatus,
} from '../../plugins/plugin-host/extension-points';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { HubClaimError } from './hub-claim.errors';

type Who = 'admin' | 'member' | 'outsider';

interface Scenario {
  status: HubClaimProviderStatus;
  claim?: (id: string, options: unknown) => HubClaimResult;
}

interface ClaimCall {
  ctx: HubClaimContext;
  candidateId: string;
  options: Record<string, unknown> | undefined;
}

/** A provider serving exactly the hubs in its table. */
class FakeProvider implements HubClaimProvider {
  readonly table = new Map<number, Scenario>();
  readonly statusCalls: HubClaimContext[] = [];
  readonly claimCalls: ClaimCall[] = [];

  constructor(readonly pluginSlug: string) {}

  supports(hub: HubClaimHubRef): boolean {
    return this.table.has(hub.id);
  }

  status(ctx: HubClaimContext): Promise<HubClaimProviderStatus> {
    this.statusCalls.push(ctx);
    return Promise.resolve(this.scenario(ctx).status);
  }

  claim(
    ctx: HubClaimContext,
    candidateId: string,
    options: Record<string, unknown> | undefined,
  ): Promise<HubClaimResult> {
    this.claimCalls.push({ ctx, candidateId, options });
    const run = this.scenario(ctx).claim;
    if (!run) throw new Error('scenario has no claim');
    return Promise.resolve(run(candidateId, options));
  }

  private scenario(ctx: HubClaimContext): Scenario {
    const s = this.table.get(ctx.hub.id);
    if (!s) throw new Error(`no scenario for hub ${ctx.hub.id}`);
    return s;
  }
}

const fake = new FakeProvider(PELICAN_PLUGIN_ID);
const rival = new FakeProvider('fake-rival');

let testApp: TestApp;
const tokens = {} as Record<Who, string>;
const userIds = {} as Record<Who, number>;
let seq = 0;

const registry = () => testApp.app.get(PluginRegistryService);

function cand(
  id: string,
  match: HubClaimCandidate['match'] = null,
): HubClaimCandidate {
  return {
    id,
    name: `Char ${id}`,
    subtitle: null,
    avatarUrl: null,
    detailPath: null,
    match,
    matchReason: match === null ? null : 'linked_account',
  };
}

function plainStatus(candidates: HubClaimCandidate[]): HubClaimProviderStatus {
  return {
    viewerHasClaim: false,
    unclaimedCount: candidates.length,
    candidates,
    claimOptions: 'none',
  };
}

function okClaim(id: string): HubClaimResult {
  return { claimed: cand(id), becameMember: true, characterId: null };
}

beforeAll(async () => {
  testApp = await getTestApp();
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
  userIds.admin = testApp.seed.adminUser.id;
  for (const who of ['member', 'outsider'] as const) {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:hc-${who}@hub-claim.test`,
          username: `hc-${who}`,
          displayName: `Claim ${who}`,
          role: 'member',
        })
        .returning(),
      `user ${who}`,
    );
    userIds[who] = u.id;
    tokens[who] = await signTestAccessToken(testApp, {
      sub: u.id,
      username: u.username,
      role: 'member',
    });
  }
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  for (const p of [fake, rival]) {
    registry().registerAdapter(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      p.pluginSlug,
      p,
      { ownerPluginId: PELICAN_PLUGIN_ID },
    );
  }
});

beforeEach(async () => {
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
});

afterAll(() => {
  fake.table.clear();
  rival.table.clear();
});

/** A live community hub with `member` as a plain member. */
async function communityHub(): Promise<number> {
  seq += 1;
  const name = `Hub Claim ${seq} ${Date.now()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        lastSnapshotAt: new Date(),
        status: 'active',
      })
      .returning(),
    'community hub',
  );
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId: g.id, userId: userIds.member, role: 'member' });
  return g.id;
}

/** A hub the fake serves with `scenario`. */
async function servedHub(scenario: Scenario): Promise<number> {
  const id = await communityHub();
  fake.table.set(id, scenario);
  return id;
}

/** Response headers minus the ones that legitimately vary per request. */
const VARYING_HEADERS = new Set(['date', 'x-request-id', 'x-correlation-id']);
function stableHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).filter(([k]) => !VARYING_HEADERS.has(k)),
  );
}

function getStatus(id: number, who: Who | null = 'member') {
  const req = testApp.request.get(`/guilds/${id}/claim`);
  return who === null ? req : req.set('Authorization', `Bearer ${tokens[who]}`);
}

function postClaim(
  id: number,
  candidateId: string,
  body: unknown = {},
  who: Who | null = 'member',
) {
  const req = testApp.request
    .post(`/guilds/${id}/claim/${candidateId}`)
    .send(body as object);
  return who === null ? req : req.set('Authorization', `Bearer ${tokens[who]}`);
}

describe('GET guilds/:id/claim — availability', () => {
  it('404 HUB_CLAIM_UNAVAILABLE when no provider supports the hub', async () => {
    const id = await communityHub();
    const res = await getStatus(id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
  });

  it('a guild id that does not exist answers the plain guard 404 (no claim code)', async () => {
    const res = await getStatus(2_000_000_000);
    expect(res.status).toBe(404);
    expect(res.body.code).toBeUndefined();
    expect(res.body.message).toBe('Guild not found');
  });

  it("404 while the provider's owner plugin is inactive, 200 once re-activated", async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    await registry().deactivate(PELICAN_PLUGIN_ID);
    const off = await getStatus(id);
    expect(off.status).toBe(404);
    expect(off.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    const offPost = await postClaim(id, 'a');
    expect(offPost.status).toBe(404);
    expect(offPost.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
    await registry().activate(PELICAN_PLUGIN_ID);
    expect((await getStatus(id)).status).toBe(200);
  });

  it('404 HUB_CLAIM_UNAVAILABLE when two live providers claim the hub', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    rival.table.set(id, { status: plainStatus([cand('b')]) });
    const res = await getStatus(id);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_UNAVAILABLE');
  });

  it('hidden hub: 404 for a non-staff member (guard), 200 for staff', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, id));
    const hidden = await getStatus(id, 'member');
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBeUndefined();
    expect((await getStatus(id, 'admin')).status).toBe(200);
  });
});

describe('guilds/:id/claim — hidden hub is indistinguishable from missing', () => {
  it('hidden hub and missing guild give byte-identical 404 bodies (GET + POST)', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, id));
    const missing = 2_000_000_001;
    const [hGet, mGet] = [await getStatus(id), await getStatus(missing)];
    expect([hGet.status, mGet.status]).toEqual([404, 404]);
    expect(mGet.text).toBe(hGet.text);
    const [hPost, mPost] = [
      await postClaim(id, 'a'),
      await postClaim(missing, 'a'),
    ];
    expect([hPost.status, mPost.status]).toEqual([404, 404]);
    expect(mPost.text).toBe(hPost.text);
  });

  it('hidden hub and missing guild give identical 404 headers (GET + POST)', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, id));
    const missing = 2_000_000_002;
    const [hGet, mGet] = [await getStatus(id), await getStatus(missing)];
    expect([hGet.status, mGet.status]).toEqual([404, 404]);
    expect(stableHeaders(mGet.headers)).toEqual(stableHeaders(hGet.headers));
    const [hPost, mPost] = [
      await postClaim(id, 'a'),
      await postClaim(missing, 'a'),
    ];
    expect([hPost.status, mPost.status]).toEqual([404, 404]);
    expect(stableHeaders(mPost.headers)).toEqual(stableHeaders(hPost.headers));
  });

  it('401 without a JWT', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    expect((await getStatus(id, null)).status).toBe(401);
    expect((await postClaim(id, 'a', {}, null)).status).toBe(401);
  });
});

describe('GET guilds/:id/claim — status body', () => {
  it('200 for a member: viewerIsMember, provider slug, no-store, schema-valid', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    const res = await getStatus(id, 'member');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(HubClaimStatusSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({
      provider: PELICAN_PLUGIN_ID,
      viewerIsMember: true,
      viewerHasClaim: false,
      unclaimedCount: 1,
      truncated: false,
      claimOptions: 'none',
    });
    const ctx = fake.statusCalls.at(-1);
    expect(ctx?.hub).toMatchObject({ id, kind: 'game_community' });
    expect(ctx?.actor.id).toBe(userIds.member);
  });

  it('200 for a non-member with viewerIsMember false (core does not refuse)', async () => {
    const id = await servedHub({ status: plainStatus([cand('a')]) });
    const res = await getStatus(id, 'outsider');
    expect(res.status).toBe(200);
    expect(res.body.viewerIsMember).toBe(false);
  });
});

describe('GET guilds/:id/claim — ranking and contract', () => {
  it('suggested is null when two candidates are strong', async () => {
    const id = await servedHub({
      status: plainStatus([cand('a', 'strong'), cand('b', 'strong')]),
    });
    const res = await getStatus(id);
    expect(res.status).toBe(200);
    expect(res.body.suggested).toBeNull();
  });

  it('suggested is the single strong candidate', async () => {
    const id = await servedHub({
      status: plainStatus([cand('p', 'possible'), cand('s', 'strong')]),
    });
    const res = await getStatus(id);
    expect(res.status).toBe(200);
    expect(res.body.suggested?.id).toBe('s');
  });

  it('caps 60 candidates at 50 and sets truncated', async () => {
    const list = Array.from({ length: 60 }, (_, i) => cand(`c${i}`));
    const id = await servedHub({ status: plainStatus(list) });
    const res = await getStatus(id);
    expect(res.status).toBe(200);
    expect(res.body.candidates).toHaveLength(50);
    expect(res.body.unclaimedCount).toBe(60);
    expect(res.body.truncated).toBe(true);
  });

  it('500 (never a malformed body) when the provider breaks the contract', async () => {
    const bad = { ...cand('a'), name: '' };
    const id = await servedHub({ status: plainStatus([bad]) });
    const res = await getStatus(id);
    expect(res.status).toBe(500);
    expect(res.body.candidates).toBeUndefined();
  });

  it('403 HUB_CLAIM_FORBIDDEN when the provider refuses the viewer', async () => {
    const id = await communityHub();
    const refusing: Scenario = {
      get status(): HubClaimProviderStatus {
        throw new HubClaimError('HUB_CLAIM_FORBIDDEN');
      },
    };
    fake.table.set(id, refusing);
    const res = await getStatus(id);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('HUB_CLAIM_FORBIDDEN');
  });
});

describe('POST guilds/:id/claim/:candidateId', () => {
  it('200 with a schema-valid result, no-store; options reach the provider', async () => {
    const id = await servedHub({
      status: plainStatus([cand('12:Generic:Human:1')]),
      claim: (cid) => okClaim(cid),
    });
    const res = await postClaim(id, '12:Generic:Human:1', {
      options: { ruleset: 'hc' },
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(HubClaimResultSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.claimed.id).toBe('12:Generic:Human:1');
    const call = fake.claimCalls.at(-1);
    expect(call?.candidateId).toBe('12:Generic:Human:1');
    expect(call?.options).toEqual({ ruleset: 'hc' });
    expect(call?.ctx.hub.id).toBe(id);
  });
});

describe('POST guilds/:id/claim/:candidateId — errors', () => {
  it.each([
    ['HUB_CLAIM_CANDIDATE_TAKEN', 409],
    ['HUB_CLAIM_VIEWER_HAS_CLAIM', 409],
    ['HUB_CLAIM_CANDIDATE_GONE', 404],
    ['HUB_CLAIM_FORBIDDEN', 403],
  ] as const)(
    'provider throws %s ⇒ %i with that code',
    async (code, status) => {
      const id = await servedHub({
        status: plainStatus([cand('a')]),
        claim: () => {
          throw new HubClaimError(code);
        },
      });
      const res = await postClaim(id, 'a');
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
    },
  );

  it('400 HUB_CLAIM_BAD_OPTIONS for a malformed body; provider not called', async () => {
    const id = await servedHub({
      status: plainStatus([cand('a')]),
      claim: (cid) => okClaim(cid),
    });
    const before = fake.claimCalls.length;
    const res = await postClaim(id, 'a', { options: 3 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('HUB_CLAIM_BAD_OPTIONS');
    expect(fake.claimCalls.length).toBe(before);
  });

  it('404 HUB_CLAIM_CANDIDATE_GONE for an id outside the id grammar', async () => {
    const id = await servedHub({
      status: plainStatus([cand('a')]),
      claim: (cid) => okClaim(cid),
    });
    const before = fake.claimCalls.length;
    const res = await postClaim(id, 'a%2Fb');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('HUB_CLAIM_CANDIDATE_GONE');
    expect(fake.claimCalls.length).toBe(before);
  });

  it('500 when the provider returns a malformed result', async () => {
    const id = await servedHub({
      status: plainStatus([cand('a')]),
      claim: () => ({
        ...okClaim('a'),
        characterId: null,
        becameMember: true,
        claimed: { ...cand('a'), name: '' },
      }),
    });
    const res = await postClaim(id, 'a');
    expect(res.status).toBe(500);
  });
});
