/**
 * TDD tests for StandalonePollNotificationService (ROK-1016).
 * Validates that scheduling poll DMs include creator context and
 * avoid repeating the game name in the message body.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { NotificationService } from '../../notifications/notification.service';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

function makeMockDb() {
  return { execute: jest.fn().mockResolvedValue([]) };
}

function makeMockNotificationService() {
  return { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) };
}

// ---------------------------------------------------------------------------
// Test module builder
// ---------------------------------------------------------------------------

async function createTestModule() {
  const mockDb = makeMockDb();
  const mockNotificationService = makeMockNotificationService();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      StandalonePollNotificationService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: NotificationService, useValue: mockNotificationService },
    ],
  }).compile();

  return {
    service: module.get(StandalonePollNotificationService),
    mockDb,
    mockNotificationService,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GAME_ID = 5;
const GAME_NAME = 'Elden Ring';
const LINEUP_ID = 42;
const MATCH_ID = 100;
const CREATOR_ID = 10;
const RECIPIENT_IDS = [20, 21];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StandalonePollNotificationService (ROK-1016)', () => {
  let service: StandalonePollNotificationService;
  let mockDb: ReturnType<typeof makeMockDb>;
  let mockNotificationService: ReturnType<typeof makeMockNotificationService>;

  beforeEach(async () => {
    const ctx = await createTestModule();
    service = ctx.service;
    mockDb = ctx.mockDb;
    mockNotificationService = ctx.mockNotificationService;
  });

  // -----------------------------------------------------------------------
  // AC1: Game name appears once in embed title, not repeated in message
  // -----------------------------------------------------------------------
  describe('AC1 — game name not repeated in message', () => {
    it('message does NOT contain the game name', async () => {
      // First execute call: findRecipients returns user IDs
      mockDb.execute.mockResolvedValueOnce(
        RECIPIENT_IDS.map((id) => ({ id })),
      );
      // Second execute call: creator lookup returns a user
      mockDb.execute.mockResolvedValueOnce([
        { displayName: 'TestCreator', username: 'testcreator' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const createCalls = mockNotificationService.create.mock.calls;
      expect(createCalls.length).toBeGreaterThan(0);

      for (const [input] of createCalls) {
        expect(input.message).not.toContain(GAME_NAME);
      }
    });

    it('title still contains the game name', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: 'TestCreator', username: 'testcreator' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const createCalls = mockNotificationService.create.mock.calls;
      expect(createCalls.length).toBeGreaterThan(0);

      for (const [input] of createCalls) {
        expect(input.title).toContain(GAME_NAME);
      }
    });
  });

  // -----------------------------------------------------------------------
  // AC2: DM message includes who created the poll
  // -----------------------------------------------------------------------
  describe('AC2 — message includes creator name', () => {
    it('message contains the creator display name', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: 'Roknua', username: 'roknua' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const [input] = mockNotificationService.create.mock.calls[0];
      expect(input.message).toContain('Roknua');
    });
  });

  // -----------------------------------------------------------------------
  // AC3: DM message explains the flow
  // -----------------------------------------------------------------------
  describe('AC3 — message explains the flow', () => {
    it('message contains availability explanation', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: 'TestCreator', username: 'testcreator' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const [input] = mockNotificationService.create.mock.calls[0];
      expect(input.message).toContain(
        'set your availability so the group can find the best time to play',
      );
    });
  });

  // -----------------------------------------------------------------------
  // AC4: Message is distinct from title (no duplicate text)
  // -----------------------------------------------------------------------
  describe('AC4 — message is distinct from title', () => {
    it('message does NOT start with "A scheduling poll for"', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: 'TestCreator', username: 'testcreator' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const [input] = mockNotificationService.create.mock.calls[0];
      expect(input.message).not.toMatch(/^A scheduling poll for/);
    });
  });

  // -----------------------------------------------------------------------
  // AC5: When creator has no displayName, username is used as fallback
  // -----------------------------------------------------------------------
  describe('AC5 — username fallback when no displayName', () => {
    it('uses username when displayName is null', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: null, username: 'fallbackuser' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const [input] = mockNotificationService.create.mock.calls[0];
      expect(input.message).toContain('fallbackuser');
      expect(input.message).not.toContain('null');
    });

    it('uses "Someone" when neither displayName nor username exists', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: null, username: null },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const [input] = mockNotificationService.create.mock.calls[0];
      expect(input.message).toContain('Someone');
    });
  });

  // -----------------------------------------------------------------------
  // Payload — creatorName field is present
  // -----------------------------------------------------------------------
  describe('payload includes creatorName', () => {
    it('adds creatorName to notification payload', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 20 }]);
      mockDb.execute.mockResolvedValueOnce([
        { displayName: 'Roknua', username: 'roknua' },
      ]);

      await service.notifyInterestedUsers(
        GAME_ID,
        GAME_NAME,
        LINEUP_ID,
        MATCH_ID,
        CREATOR_ID,
      );

      const [input] = mockNotificationService.create.mock.calls[0];
      expect(input.payload).toEqual(
        expect.objectContaining({ creatorName: 'Roknua' }),
      );
    });
  });
});
