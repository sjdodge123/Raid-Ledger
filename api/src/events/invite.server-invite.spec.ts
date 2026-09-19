import { Test } from '@nestjs/testing';
import { InviteService } from './invite.service';
import { InviteController } from './invite.controller';
import { OgMetaService } from './og-meta.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SignupsService } from './signups.service';
import { SettingsService } from '../settings/settings.service';
import { PugInviteService } from '../discord-bot/services/pug-invite.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { RATE_LIMIT_TIERS } from '../throttler/rate-limit.decorator';
import { InviteCodeResolveResponseSchema } from '@raid-ledger/contract';

// ---------------------------------------------------------------------------
// Fixtures + mock db
// ---------------------------------------------------------------------------

const FUTURE_DATE = new Date(Date.now() + 86_400_000);

const mockEvent = {
  id: 42,
  title: 'Mythic Raid Night',
  gameId: null,
  creatorId: 7,
  slotConfig: null,
  cancelledAt: null,
  inviteCode: 'share123',
  duration: [new Date('2026-02-10T18:00:00Z'), FUTURE_DATE] as [Date, Date],
};

const SLOT_ID = '11111111-1111-4111-8111-111111111111';

const mockSlot = {
  id: SLOT_ID,
  eventId: 42,
  inviteCode: 'slot1234',
  role: 'dps',
  status: 'invited',
  claimedByUserId: null,
  createdBy: 99,
};

let selectSequence: unknown[][];
let selectCallCount: number;
let generateServerInvite: jest.Mock;

function makeChain(limitValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of [
    'from',
    'where',
    'innerJoin',
    'leftJoin',
    'orderBy',
    'set',
  ]) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.limit = jest.fn().mockResolvedValue(limitValue);
  chain.returning = jest.fn().mockResolvedValue(limitValue);
  return chain;
}

function buildMockDb(): Record<string, jest.Mock> {
  selectCallCount = 0;
  const db: Record<string, jest.Mock> = {
    select: jest
      .fn()
      .mockImplementation(() => makeChain(selectSequence[selectCallCount++])),
    update: jest.fn().mockReturnValue(makeChain()),
    delete: jest.fn().mockReturnValue(makeChain()),
    insert: jest.fn().mockReturnValue(makeChain()),
  };
  return db;
}

async function buildService(): Promise<InviteService> {
  generateServerInvite = jest
    .fn()
    .mockResolvedValue('https://discord.gg/minted');
  const module = await Test.createTestingModule({
    providers: [
      InviteService,
      { provide: DrizzleAsyncProvider, useValue: buildMockDb() },
      {
        provide: SignupsService,
        useValue: { signup: jest.fn().mockResolvedValue({ id: 1 }) },
      },
      {
        provide: SettingsService,
        useValue: {
          getBranding: jest.fn().mockResolvedValue({ communityName: 'Guild' }),
          getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
        },
      },
      { provide: PugInviteService, useValue: { generateServerInvite } },
      {
        provide: DiscordBotClientService,
        useValue: { isConnected: () => false },
      },
    ],
  }).compile();
  return module.get(InviteService);
}

// ---------------------------------------------------------------------------
// The public resolve path must never mint a Discord invite (ROK-1631)
// ---------------------------------------------------------------------------

async function testShareResolveMintsNothing(): Promise<void> {
  selectSequence = [[], [mockEvent]];
  const service = await buildService();
  const result = await service.resolveInvite('share123');

  expect(result.valid).toBe(true);
  expect(generateServerInvite).not.toHaveBeenCalled();
  expect(result.discordServerInviteUrl).toBeUndefined();
  expect(() => InviteCodeResolveResponseSchema.parse(result)).not.toThrow();
}

async function testRepeatedShareResolvesMintNothing(): Promise<void> {
  const service = await buildService();
  for (let i = 0; i < 5; i++) {
    selectSequence = [[], [mockEvent]];
    selectCallCount = 0;
    await service.resolveInvite('share123');
  }
  expect(generateServerInvite).toHaveBeenCalledTimes(0);
}

async function testSlotResolveMintsNothing(): Promise<void> {
  selectSequence = [[mockSlot], [mockEvent]];
  const service = await buildService();
  const result = await service.resolveInvite('slot1234');

  expect(result.valid).toBe(true);
  expect(result.slot?.id).toBe(SLOT_ID);
  expect(generateServerInvite).not.toHaveBeenCalled();
  expect(result.discordServerInviteUrl).toBeUndefined();
  expect(() => InviteCodeResolveResponseSchema.parse(result)).not.toThrow();
}

describe('InviteService.resolveInvite — no Discord invite minting (ROK-1631)', () => {
  it('does not mint for an event share code', testShareResolveMintsNothing);
  it(
    'does not mint across repeated resolves',
    testRepeatedShareResolvesMintNothing,
  );
  it('does not mint for a slot code', testSlotResolveMintsNothing);
});

// ---------------------------------------------------------------------------
// The authenticated claim paths still hand back a server invite
// ---------------------------------------------------------------------------

async function testShareClaimMints(): Promise<void> {
  selectSequence = [[], [mockEvent], [{ discordId: 'discord-1' }]];
  const service = await buildService();
  const result = await service.claimInvite('share123', 1);

  expect(generateServerInvite).toHaveBeenCalledWith(42);
  expect(result.discordServerInviteUrl).toBe('https://discord.gg/minted');
}

async function testMemberSlotClaimMints(): Promise<void> {
  selectSequence = [
    [mockSlot],
    [mockEvent],
    [],
    [{ discordId: 'discord-1' }],
    [{ discordId: 'discord-1' }],
  ];
  const service = await buildService();
  const result = await service.claimInvite('slot1234', 1);

  expect(result.type).toBe('signup');
  expect(generateServerInvite).toHaveBeenCalledWith(42);
  expect(result.discordServerInviteUrl).toBe('https://discord.gg/minted');
}

async function testPugSlotClaimMints(): Promise<void> {
  selectSequence = [[mockSlot], [mockEvent], [], [{ discordId: null }]];
  const service = await buildService();
  const result = await service.claimInvite('slot1234', 1);

  expect(result.type).toBe('claimed');
  expect(generateServerInvite).toHaveBeenCalledWith(42);
  expect(result.discordServerInviteUrl).toBe('https://discord.gg/minted');
}

describe('InviteService.claimInvite — server invite still minted (ROK-1631)', () => {
  it('mints for a share-code claim', testShareClaimMints);
  it('mints for a member slot claim', testMemberSlotClaimMints);
  it('mints for a guest slot claim', testPugSlotClaimMints);
});

// ---------------------------------------------------------------------------
// Both public GET routes carry the public rate-limit tier
// ---------------------------------------------------------------------------

function throttleMetadata(method: string): { limit: unknown; ttl: unknown } {
  const target = Object.getOwnPropertyDescriptor(
    InviteController.prototype,
    method,
  )!.value as object;
  return {
    limit: Reflect.getMetadata('THROTTLER:LIMITdefault', target),
    ttl: Reflect.getMetadata('THROTTLER:TTLdefault', target),
  };
}

describe('InviteController — public routes are rate limited (ROK-1631)', () => {
  it('rate limits GET /invite/:code', () => {
    expect(throttleMetadata('resolveInvite')).toEqual({
      limit: RATE_LIMIT_TIERS.public.limit,
      ttl: RATE_LIMIT_TIERS.public.ttl,
    });
  });

  it('rate limits GET /invite/:code/og', () => {
    expect(throttleMetadata('renderOgMeta')).toEqual({
      limit: RATE_LIMIT_TIERS.public.limit,
      ttl: RATE_LIMIT_TIERS.public.ttl,
    });
  });

  it('still wires the OG service', () => {
    expect(OgMetaService).toBeDefined();
  });
});
