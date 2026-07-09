import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AuthService } from './auth.service';
import type { UsersService } from '../users/users.service';
import * as schema from '../drizzle/schema';
import { KICK_COOLDOWN_MS } from './auth-status.helpers';
import { clearAuthUserCache } from './auth-user-cache';

type Db = PostgresJsDatabase<typeof schema>;

/** Fluent mock for the kick auto-clear `db.update(users).set().where()`. */
function makeDbWithUpdate() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  return { db: { update } as unknown as Db, update };
}

const mockJwt = {} as unknown as JwtService;

function existingRow(overrides: Record<string, unknown>) {
  return {
    id: 5,
    discordId: 'discord-5',
    username: 'existing',
    bannedAt: null,
    banReason: null,
    kickedAt: null,
    kickReason: null,
    ...overrides,
  };
}

interface Harness {
  service: AuthService;
  users: {
    findByDiscordIdIncludingUnlinked: jest.Mock;
    createOrUpdate: jest.Mock;
    relinkDiscord: jest.Mock;
  };
  emit: jest.Mock;
  update: jest.Mock;
}

function makeService(existing: Record<string, unknown> | null): Harness {
  const { db, update } = makeDbWithUpdate();
  const users = {
    findByDiscordIdIncludingUnlinked: jest.fn().mockResolvedValue(existing),
    createOrUpdate: jest
      .fn()
      .mockResolvedValue({ id: 5, username: 'existing' }),
    relinkDiscord: jest.fn(),
  };
  const emit = jest.fn();
  const service = new AuthService(
    users as unknown as UsersService,
    mockJwt,
    db,
    { emit } as unknown as EventEmitter2,
  );
  return { service, users, emit, update };
}

afterEach(() => clearAuthUserCache());

describe('AuthService.validateDiscordUser — ban/kick enforcement (ROK-313 AC4/AC2)', () => {
  it('rejects a banned existing user with USER_SUSPENDED and skips createOrUpdate', async () => {
    const { service, users } = makeService(
      existingRow({ bannedAt: new Date(), banReason: 'cheating' }),
    );

    let caught: ForbiddenException | undefined;
    try {
      await service.validateDiscordUser('discord-5', 'name');
    } catch (err) {
      caught = err as ForbiddenException;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught!.getResponse() as Record<string, unknown>).code).toBe(
      'USER_SUSPENDED',
    );
    expect(users.createOrUpdate).not.toHaveBeenCalled();
  });

  it('rejects a kicked existing user still inside the cooldown', async () => {
    const { service, users, update } = makeService(
      existingRow({ kickedAt: new Date(Date.now() - 60_000) }),
    );

    await expect(
      service.validateDiscordUser('discord-5', 'name'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.createOrUpdate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('auto-clears an expired kick then proceeds to createOrUpdate', async () => {
    const { service, users, emit, update } = makeService(
      existingRow({ kickedAt: new Date(Date.now() - KICK_COOLDOWN_MS - 1) }),
    );

    await service.validateDiscordUser('discord-5', 'name', 'avatar');

    // Cooldown elapsed → kick cleared via db.update, then normal login proceeds.
    expect(update).toHaveBeenCalledTimes(1);
    expect(users.createOrUpdate).toHaveBeenCalledWith({
      discordId: 'discord-5',
      username: 'name',
      avatar: 'avatar',
    });
    expect(emit).toHaveBeenCalled();
  });

  it('lets a clean brand-new user through (no existing row, no guard trip)', async () => {
    const { service, users, update } = makeService(null);

    await service.validateDiscordUser('discord-new', 'name');

    expect(update).not.toHaveBeenCalled();
    expect(users.createOrUpdate).toHaveBeenCalled();
  });
});
