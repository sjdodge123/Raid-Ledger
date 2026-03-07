import { Test, TestingModule } from '@nestjs/testing';
import { PugInviteListener } from './pug-invite.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PugInviteService } from '../services/pug-invite.service';
import { CharactersService } from '../../characters/characters.service';
import { SignupsService } from '../../events/signups.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  PugsService,
  type PugSlotCreatedPayload,
} from '../../events/pugs.service';
import type { DiscordLoginPayload } from '../../auth/auth.service';
import { Events } from 'discord.js';

let testModule: TestingModule;
let listener: PugInviteListener;
let clientService: jest.Mocked<DiscordBotClientService>;
let pugInviteService: jest.Mocked<PugInviteService>;

function buildPugInviteProviders() {
  return [
    PugInviteListener,
    {
      provide: DrizzleAsyncProvider,
      useValue: {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        delete: jest.fn().mockReturnThis(),
      },
    },
    {
      provide: DiscordBotClientService,
      useValue: { getClient: jest.fn().mockReturnValue(null) },
    },
    {
      provide: PugInviteService,
      useValue: {
        processPugSlotCreated: jest.fn().mockResolvedValue(undefined),
        handleNewGuildMember: jest.fn().mockResolvedValue(undefined),
        claimPugSlots: jest.fn().mockResolvedValue(0),
        sendMemberInviteDm: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: CharactersService,
      useValue: {
        findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
        findOne: jest.fn().mockResolvedValue(null),
      },
    },
    {
      provide: SignupsService,
      useValue: {
        signup: jest.fn().mockResolvedValue({ id: 1 }),
        confirmSignup: jest.fn().mockResolvedValue(undefined),
      },
    },
    {
      provide: PugsService,
      useValue: { findByInviteCode: jest.fn().mockResolvedValue(null) },
    },
  ];
}

async function setupPugInviteModule() {
  testModule = await Test.createTestingModule({
    providers: buildPugInviteProviders(),
  }).compile();

  listener = testModule.get(PugInviteListener);
  clientService = testModule.get(DiscordBotClientService);
  pugInviteService = testModule.get(PugInviteService);
}

describe('PugInviteListener', () => {
  beforeEach(async () => {
    await setupPugInviteModule();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await testModule.close();
  });

  describe('handlePugSlotCreated', () => {
    pugSlotCreatedTests();
  });

  describe('handleDiscordLogin', () => {
    discordLoginTests();
  });

  describe('handleBotConnected', () => {
    botConnectedTests();
  });

  describe('handleBotDisconnected', () => {
    botDisconnectedTests();
  });

  describe('handleMemberInviteCreated', () => {
    memberInviteCreatedTests();
  });
});

function pugSlotCreatedTests() {
  it('should call processPugSlotCreated with correct payload', async () => {
    const payload: PugSlotCreatedPayload = {
      pugSlotId: 'slot-uuid',
      eventId: 42,
      discordUsername: 'testplayer',
      creatorUserId: 1,
    };
    await listener.handlePugSlotCreated(payload);
    expect(pugInviteService.processPugSlotCreated).toHaveBeenCalledWith(
      'slot-uuid',
      42,
      'testplayer',
      1,
    );
  });

  it('should skip anonymous PUG slots (null discordUsername)', async () => {
    const payload: PugSlotCreatedPayload = {
      pugSlotId: 'slot-uuid',
      eventId: 42,
      discordUsername: null,
      creatorUserId: 1,
    };
    await listener.handlePugSlotCreated(payload);
    expect(pugInviteService.processPugSlotCreated).not.toHaveBeenCalled();
  });
}

function discordLoginTests() {
  it('should call claimPugSlots with discord ID and user ID', async () => {
    const payload: DiscordLoginPayload = {
      userId: 10,
      discordId: 'disc-user-456',
    };
    await listener.handleDiscordLogin(payload);
    expect(pugInviteService.claimPugSlots).toHaveBeenCalledWith(
      'disc-user-456',
      10,
      undefined,
    );
  });

  it('should handle claim errors gracefully', async () => {
    pugInviteService.claimPugSlots.mockRejectedValue(new Error('DB error'));
    const payload: DiscordLoginPayload = {
      userId: 10,
      discordId: 'disc-user-456',
    };
    await expect(listener.handleDiscordLogin(payload)).resolves.not.toThrow();
  });
}

function createMockClientWithListeners() {
  const mockOn = jest.fn();
  const mockRemoveListener = jest.fn();
  const mockClient = { on: mockOn, removeListener: mockRemoveListener };
  clientService.getClient.mockReturnValue(mockClient as never);
  return { mockOn, mockRemoveListener, mockClient };
}

function botConnectedTests() {
  it('should register guildMemberAdd and interactionCreate listeners', () => {
    const { mockOn } = createMockClientWithListeners();
    listener.handleBotConnected();
    expect(mockOn).toHaveBeenCalledWith(
      Events.GuildMemberAdd,
      expect.any(Function),
    );
    expect(mockOn).toHaveBeenCalledWith(
      'interactionCreate',
      expect.any(Function),
    );
  });

  it('should not register guildMemberAdd twice on repeated connect events', () => {
    const { mockOn } = createMockClientWithListeners();
    listener.handleBotConnected();
    listener.handleBotConnected();
    const guildMemberCalls = mockOn.mock.calls.filter(
      ([event]: [string]) => event === (Events.GuildMemberAdd as string),
    );
    expect(guildMemberCalls).toHaveLength(1);
  });

  it('should skip when client is null', () => {
    clientService.getClient.mockReturnValue(null);
    listener.handleBotConnected();
    expect(clientService.getClient).toHaveBeenCalled();
  });

  it('should call handleNewGuildMember when guildMemberAdd fires', async () => {
    const { mockOn } = createMockClientWithListeners();
    listener.handleBotConnected();
    const guildMemberCall = mockOn.mock.calls.find(
      ([event]: [string]) => event === (Events.GuildMemberAdd as string),
    ) as [string, (member: unknown) => Promise<void>];
    const callback = guildMemberCall[1];
    const mockMember = {
      user: {
        id: 'new-user-id',
        username: 'newplayer',
        avatar: 'avatar-hash-xyz',
      },
    };
    await callback(mockMember);
    expect(pugInviteService.handleNewGuildMember).toHaveBeenCalledWith(
      'new-user-id',
      'newplayer',
      'avatar-hash-xyz',
    );
  });
}

function botDisconnectedTests() {
  it('should allow guildMemberAdd re-registration after disconnect', () => {
    const { mockOn } = createMockClientWithListeners();
    listener.handleBotConnected();
    listener.handleBotDisconnected();
    listener.handleBotConnected();
    const guildMemberCalls = mockOn.mock.calls.filter(
      ([event]: [string]) => event === (Events.GuildMemberAdd as string),
    );
    expect(guildMemberCalls).toHaveLength(2);
  });

  it('should clear boundInteractionHandler reference on disconnect', () => {
    const { mockRemoveListener } = createMockClientWithListeners();
    listener.handleBotConnected();
    listener.handleBotDisconnected();
    listener.handleBotConnected();
    expect(mockRemoveListener).not.toHaveBeenCalled();
  });
}

function memberInviteCreatedTests() {
  it('should delegate to pugInviteService.sendMemberInviteDm', async () => {
    const payload = {
      eventId: 42,
      targetDiscordId: 'discord-user-789',
      notificationId: 'notif-uuid',
      gameId: null,
    };
    await listener.handleMemberInviteCreated(payload);
    expect(pugInviteService.sendMemberInviteDm).toHaveBeenCalledWith(
      42,
      'discord-user-789',
      'notif-uuid',
      null,
    );
  });
}
