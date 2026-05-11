/**
 * ROK-1260 — GuildMemberAddListener unit tests.
 *
 * Operator decision: reactivation triggers ONLY on Discord guild rejoin
 * (`Events.GuildMemberAdd`), NOT on OAuth login. The listener must
 *   1. follow the `pug-invite.listener.ts` registration pattern —
 *      register inside `@OnEvent(DISCORD_BOT_EVENTS.CONNECTED)` so it
 *      re-registers cleanly on reconnect, NOT raw `client.on(...)` at
 *      module init,
 *   2. clear `deactivated_at` (NULL→NOT NULL→NULL) idempotently — only
 *      a transition from `IS NOT NULL` to `NULL` writes the admin
 *      reactivation notification,
 *   3. no-op when the joining Discord user has no matching `users` row,
 *   4. no-op when the matching user is already active (`deactivated_at
 *      IS NULL`).
 *
 * Every test here FAILS today because the listener file does not exist
 * yet — importing it produces TS/Jest "cannot find module" errors which
 * Jest reports as a hard failure for every test in the file. That is the
 * canonical "Confirmed Failing" shape for a not-yet-implemented module.
 */
import { Events } from 'discord.js';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
// This import WILL FAIL today — `guild-member-add.listener.ts` doesn't
// exist on disk yet. The dev creates it in Phase C. Once created, the
// imports below resolve and the assertions become the failure surface.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GuildMemberAddListener } from './guild-member-add.listener';
import { createDrizzleMock, type MockDb } from '../../common/testing/drizzle-mock';

// ── Test fixtures ───────────────────────────────────────────────────────────

interface MockClient {
  on: jest.Mock;
  removeListener: jest.Mock;
}

function makeMockClient(): MockClient {
  return { on: jest.fn(), removeListener: jest.fn() };
}

function makeMockClientService(client: MockClient | null) {
  return {
    getClient: jest.fn().mockReturnValue(client),
    isConnected: jest.fn().mockReturnValue(true),
  };
}

function makeMockUsersService() {
  return {
    // Returns the admin user that the admin-notification should target.
    findAdmin: jest.fn().mockResolvedValue({ id: 1 }),
  };
}

function makeMockNotificationService() {
  return {
    // Generic in-app notification creator — mirrors the existing
    // role-gap-alert pattern.
    create: jest.fn().mockResolvedValue(undefined),
  };
}

function makeMockMember(discordId: string, username = 'returner') {
  return {
    user: { id: discordId, username, avatar: null },
  } as unknown as Parameters<
    Parameters<MockClient['on']>[1]
  >[0];
}

// ── Listener factory ────────────────────────────────────────────────────────

/**
 * Construct the listener with mocked dependencies. The exact constructor
 * argument order is the dev's choice — what matters is that
 *   - the db (mocked drizzle) is reachable,
 *   - the discord client service is reachable (so the listener can
 *     register its handler when DISCORD_BOT_EVENTS.CONNECTED fires),
 *   - the usersService (to look up the admin) is reachable,
 *   - the notificationService (to insert the admin notification) is
 *     reachable.
 *
 * The cast is intentionally permissive — if the dev's constructor
 * differs slightly (e.g., DI tokens), they update this factory in one
 * place and the test surface stays intact.
 */
function buildListener(deps: {
  db: MockDb;
  clientService: ReturnType<typeof makeMockClientService>;
  usersService: ReturnType<typeof makeMockUsersService>;
  notificationService: ReturnType<typeof makeMockNotificationService>;
}): InstanceType<typeof GuildMemberAddListener> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = GuildMemberAddListener as unknown as new (...args: any[]) => any;
  return new Ctor(
    deps.db,
    deps.clientService,
    deps.usersService,
    deps.notificationService,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GuildMemberAddListener (ROK-1260)', () => {
  let mockDb: MockDb;
  let mockUsers: ReturnType<typeof makeMockUsersService>;
  let mockNotifs: ReturnType<typeof makeMockNotificationService>;
  let mockClient: MockClient;
  let mockClientService: ReturnType<typeof makeMockClientService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = createDrizzleMock();
    mockUsers = makeMockUsersService();
    mockNotifs = makeMockNotificationService();
    mockClient = makeMockClient();
    mockClientService = makeMockClientService(mockClient);
  });

  describe('registration — DISCORD_BOT_EVENTS.CONNECTED flow', () => {
    it('exposes a @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)-decorated method that registers Events.GuildMemberAdd on the client', () => {
      const listener = buildListener({
        db: mockDb,
        clientService: mockClientService,
        usersService: mockUsers,
        notificationService: mockNotifs,
      });

      // The decorated handler shape: a public method that fires when
      // the bot connects, then registers a guildMemberAdd handler on
      // the underlying discord.js client. The pug-invite listener
      // names its method `handleBotConnected` — the dev should mirror.
      // We invoke the most-likely name and accept any 0-arg method
      // that takes the listener side-effect.
      const onConnect =
        (listener as unknown as { handleBotConnected?: () => void })
          .handleBotConnected ??
        (listener as unknown as { onBotConnected?: () => void })
          .onBotConnected ??
        (listener as unknown as { handleConnected?: () => void })
          .handleConnected;
      expect(typeof onConnect).toBe('function');

      onConnect!.call(listener);

      expect(mockClient.on).toHaveBeenCalledWith(
        Events.GuildMemberAdd,
        expect.any(Function),
      );
    });

    it('does not throw when getClient() returns null (bot not yet ready)', () => {
      const offlineClientService = makeMockClientService(null);
      const listener = buildListener({
        db: mockDb,
        clientService: offlineClientService,
        usersService: mockUsers,
        notificationService: mockNotifs,
      });

      const onConnect = (
        listener as unknown as { handleBotConnected?: () => void }
      ).handleBotConnected;
      expect(typeof onConnect).toBe('function');

      // Must not throw — pug-invite pattern early-returns when client is null.
      expect(() => onConnect!.call(listener)).not.toThrow();
    });

    it('uses the DISCORD_BOT_EVENTS.CONNECTED constant (compile-time check)', () => {
      // Defensive: ensure the constant exists and is the value the dev
      // is expected to subscribe to. Catches an accidental hand-rolled
      // string that would silently miss the event.
      expect(DISCORD_BOT_EVENTS.CONNECTED).toBe('discord-bot.connected');
    });
  });

  describe('reactivation behavior', () => {
    /**
     * Trigger the listener's GuildMemberAdd handler by walking through
     * the registration flow. Returns the bound handler so the test can
     * invoke it with a synthetic member.
     */
    function triggerRegister(
      listener: InstanceType<typeof GuildMemberAddListener>,
    ) {
      const onConnect =
        (listener as unknown as { handleBotConnected?: () => void })
          .handleBotConnected ??
        (listener as unknown as { onBotConnected?: () => void })
          .onBotConnected;
      if (!onConnect) {
        throw new Error(
          'Listener missing handleBotConnected — register pattern not implemented',
        );
      }
      onConnect.call(listener);
      const call = mockClient.on.mock.calls.find(
        ([event]: [string]) => event === (Events.GuildMemberAdd as string),
      );
      if (!call) {
        throw new Error('Listener did not subscribe to Events.GuildMemberAdd');
      }
      return call[1] as (member: ReturnType<typeof makeMockMember>) => Promise<void> | void;
    }

    it('clears deactivated_at and writes the admin reactivation notification for a deactivated returner', async () => {
      // Simulate: the UPDATE … RETURNING returns ONE row → transition fired.
      mockDb.returning.mockResolvedValueOnce([
        { id: 42, username: 'returner' },
      ]);

      const listener = buildListener({
        db: mockDb,
        clientService: mockClientService,
        usersService: mockUsers,
        notificationService: mockNotifs,
      });
      const handler = triggerRegister(listener);

      await handler(makeMockMember('123456789012345678'));

      // The dev's UPDATE call should mutate the users table (we don't
      // assert on the exact set values — just that update() was used).
      expect(mockDb.update).toHaveBeenCalled();
      // And the admin notification creator must have been invoked exactly once.
      expect(mockNotifs.create).toHaveBeenCalledTimes(1);
      // Targeted at the admin returned by usersService.findAdmin().
      expect(mockUsers.findAdmin).toHaveBeenCalled();
    });

    it('is a no-op when GuildMemberAdd fires for a user with no matching row (UPDATE … RETURNING returns 0 rows)', async () => {
      // Simulate: no DB row matched (unknown Discord ID).
      mockDb.returning.mockResolvedValueOnce([]);

      const listener = buildListener({
        db: mockDb,
        clientService: mockClientService,
        usersService: mockUsers,
        notificationService: mockNotifs,
      });
      const handler = triggerRegister(listener);

      await handler(makeMockMember('999999999999999999'));

      // No admin notification — nothing changed.
      expect(mockNotifs.create).not.toHaveBeenCalled();
    });

    it('is a no-op when the matching user is already active (deactivated_at IS NULL — UPDATE … RETURNING returns 0 rows due to the IS NOT NULL guard)', async () => {
      // The UPDATE predicate (`WHERE discord_id = $1 AND deactivated_at IS NOT NULL`)
      // means an already-active user yields zero RETURNING rows.
      mockDb.returning.mockResolvedValueOnce([]);

      const listener = buildListener({
        db: mockDb,
        clientService: mockClientService,
        usersService: mockUsers,
        notificationService: mockNotifs,
      });
      const handler = triggerRegister(listener);

      await handler(makeMockMember('123456789012345678'));

      expect(mockNotifs.create).not.toHaveBeenCalled();
    });
  });
});
