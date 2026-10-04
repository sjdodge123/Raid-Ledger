/**
 * Shared test helpers for steam-link.listener.spec files.
 *
 * Extracted so the original ROK-966 spec (heart flow) and the new
 * ROK-1081 nomination spec can share setup without exceeding the
 * 750-line test file limit.
 */
import { SteamLinkListener } from './steam-link.listener';
import { ChannelType } from 'discord.js';

/** Every drizzle builder method the steam-link listener specs stub or read. */
export type SteamLinkDbMock = Record<
  | 'from'
  | 'where'
  | 'limit'
  | 'insert'
  | 'values'
  | 'onConflictDoNothing'
  | 'onConflictDoUpdate'
  | 'select'
  | 'orderBy',
  jest.Mock
>;

/** Flat drizzle chain: builder methods return the chain, terminals resolve. */
export function buildSteamLinkDbMock(): SteamLinkDbMock {
  const chain: SteamLinkDbMock = {
    from: jest.fn(),
    where: jest.fn(),
    limit: jest.fn().mockResolvedValue([]),
    insert: jest.fn(),
    values: jest.fn(),
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
    onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    select: jest.fn(),
    orderBy: jest.fn(),
  };
  for (const method of [
    chain.from,
    chain.where,
    chain.insert,
    chain.values,
    chain.select,
    chain.orderBy,
  ]) {
    method.mockReturnValue(chain);
  }
  return chain;
}

export interface MockContext {
  listener: SteamLinkListener;
  mockClientService: Record<'getClient', jest.Mock>;
  mockDb: SteamLinkDbMock;
  mockLineupsService: { nominate: jest.Mock };
  mockDmSend: jest.Mock;
  messageIdCounter: { count: number };
}

/**
 * Build a fresh mock context with listener, drizzle chain mock,
 * a LineupsService stub, and a DM send jest.fn.
 *
 * The returned object's fields are mutable so individual tests can
 * override behaviour (e.g. mockDb.limit.mockResolvedValueOnce(...)).
 */
export function buildMockContext(): MockContext {
  const mockClientService = { getClient: jest.fn() };

  const chain = buildSteamLinkDbMock();

  const mockLineupsService = {
    nominate: jest.fn().mockResolvedValue(undefined),
  };

  const mockModuleRef = {
    get: jest.fn().mockReturnValue(mockLineupsService),
  };

  const listener = new SteamLinkListener(
    chain as never,
    mockClientService as never,
    undefined as never,
    undefined as never,
    undefined as never,
    mockModuleRef as never,
  );

  return {
    listener,
    mockClientService,
    mockDb: chain,
    mockLineupsService,
    mockDmSend: jest.fn().mockResolvedValue({ id: 'dm-1' }),
    messageIdCounter: { count: 0 },
  };
}

export function callHandleMessage(
  listener: SteamLinkListener,
  message: unknown,
): Promise<void> {
  return (
    listener as unknown as { handleMessage: (m: unknown) => Promise<void> }
  ).handleMessage(message);
}

export function callHandleButtonInteraction(
  listener: SteamLinkListener,
  interaction: unknown,
): Promise<void> {
  return (
    listener as unknown as {
      handleButtonInteraction: (i: unknown) => Promise<void>;
    }
  ).handleButtonInteraction(interaction);
}

/** Build a Discord message-like object for use in listener tests. */
export function createMessage(
  ctx: MockContext,
  content: string,
  overrides: Record<string, unknown> = {},
) {
  ctx.messageIdCounter.count += 1;
  return {
    id: `msg-${ctx.messageIdCounter.count}`,
    content,
    author: {
      bot: false,
      id: 'discord-user-1',
      createDM: jest.fn().mockResolvedValue({ send: ctx.mockDmSend }),
    },
    guild: { id: 'guild-123' },
    channel: { type: ChannelType.GuildText, id: 'chan-1' },
    ...overrides,
  };
}

/** Build a Discord button interaction mock. */
export function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-1',
) {
  const interaction = {
    isButton: () => true,
    customId,
    user: { id: userId, username: 'TestUser' },
    replied: false,
    deferred: false,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  return interaction;
}

// --- Stub helpers for sequential DB queries ---

export function stubGameLookup(
  ctx: MockContext,
  game: { id: number; name: string; steamAppId: number } | null,
) {
  ctx.mockDb.limit.mockResolvedValueOnce(game ? [game] : []);
}

export function stubUserLookup(
  ctx: MockContext,
  user: { id: number; discordId: string } | null,
) {
  ctx.mockDb.limit.mockResolvedValueOnce(user ? [user] : []);
}

export function stubBuildingLineup(
  ctx: MockContext,
  lineup: { id: number } | null,
) {
  ctx.mockDb.limit.mockResolvedValueOnce(lineup ? [lineup] : []);
}

export function stubGameNominated(ctx: MockContext, nominated: boolean) {
  ctx.mockDb.limit.mockResolvedValueOnce(nominated ? [{ id: 1 }] : []);
}

export function stubAutoNominatePref(ctx: MockContext, enabled: boolean) {
  ctx.mockDb.limit.mockResolvedValueOnce(
    enabled ? [{ key: 'autoNominateSteamUrls', value: true }] : [],
  );
}
