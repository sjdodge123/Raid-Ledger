/**
 * ROK-2298 — `findActiveLinkedUser` is the gateway lookup every Discord
 * action entry point uses; `interactionErrorReply` is the listener catch
 * mapping. Rows come from a mocked `select().from().where().limit()` chain.
 */
import { ForbiddenException } from '@nestjs/common';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import {
  ACCOUNT_BLOCKED_REPLY,
  accountBlockedError,
} from '../../users/discord-account-status.helpers';
import {
  GENERIC_ERROR_REPLY,
  findActiveLinkedUser,
  interactionErrorReply,
} from './signup-interaction.helpers';
import type { SignupInteractionDeps } from './signup-interaction.types';

const DISCORD_ID = 'discord-77';

function depsWithRows(rows: unknown[]) {
  const limit = jest.fn().mockResolvedValue(rows);
  const chain = { from: () => chain, where: () => chain, limit };
  const db = { select: () => chain } as unknown as SignupInteractionDeps['db'];
  return { db, logger: { warn: jest.fn() } };
}

function interaction(deferred: boolean) {
  return {
    user: { id: DISCORD_ID },
    deferred,
    replied: false,
    reply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

const asButton = (i: ReturnType<typeof interaction>) =>
  i as unknown as ButtonInteraction;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    discordId: DISCORD_ID,
    bannedAt: null,
    deactivatedAt: null,
    ...over,
  };
}

describe('findActiveLinkedUser (ROK-2298)', () => {
  it('returns the linked user and replies nothing for an active account', async () => {
    const i = interaction(true);
    const user = await findActiveLinkedUser(asButton(i), depsWithRows([row()]));
    expect(user).toEqual(expect.objectContaining({ id: 9 }));
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.reply).not.toHaveBeenCalled();
  });

  it('returns null (unlinked) with no reply when no row matches', async () => {
    const i = interaction(true);
    expect(await findActiveLinkedUser(asButton(i), depsWithRows([]))).toBe(
      null,
    );
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it('returns false and edits the deferred reply for a banned account', async () => {
    const i = interaction(true);
    const deps = depsWithRows([row({ bannedAt: new Date() })]);
    expect(await findActiveLinkedUser(asButton(i), deps)).toBe(false);
    expect(i.editReply).toHaveBeenCalledWith({
      content: ACCOUNT_BLOCKED_REPLY,
      components: [],
    });
  });

  it('replies ephemerally when the interaction was not deferred (deactivated)', async () => {
    const i = interaction(false);
    const deps = depsWithRows([row({ deactivatedAt: new Date() })]);
    expect(await findActiveLinkedUser(asButton(i), deps)).toBe(false);
    expect(i.reply).toHaveBeenCalledWith({
      content: ACCOUNT_BLOCKED_REPLY,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('a banned self-unlinked account (unlinked:<id>) is still blocked (Q3)', async () => {
    const i = interaction(true);
    const deps = depsWithRows([
      row({ discordId: `unlinked:${DISCORD_ID}`, bannedAt: new Date() }),
    ]);
    expect(await findActiveLinkedUser(asButton(i), deps)).toBe(false);
  });
});

describe('interactionErrorReply (ROK-2298 catch mapping)', () => {
  it('maps ForbiddenException{code:ACCOUNT_BLOCKED} to the blocked reply', () => {
    expect(interactionErrorReply(accountBlockedError())).toBe(
      ACCOUNT_BLOCKED_REPLY,
    );
  });

  it('keeps the generic copy for any other error, including other 403s', () => {
    expect(interactionErrorReply(new ForbiddenException('x'))).toBe(
      GENERIC_ERROR_REPLY,
    );
    expect(interactionErrorReply(new Error('db'))).toBe(GENERIC_ERROR_REPLY);
  });
});
