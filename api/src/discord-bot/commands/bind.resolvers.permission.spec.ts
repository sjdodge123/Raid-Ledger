/**
 * ROK-1628: the channel paths of `/bind` and `/unbind` change guild-wide
 * routing, so they share one operator/admin check. These cover the helper
 * itself; the command specs cover the call sites.
 *
 * Account state: a banned, kick-cooldown or deactivated caller is refused by
 * both checks (admins too), with the `/login` refusal copy.
 */
import {
  BIND_DEACTIVATED_REPLY,
  checkBindingPermission,
  checkEventPermission,
} from './bind.resolvers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schemaType from '../../drizzle/schema';
import type { ChatInputCommandInteraction } from 'discord.js';

/** A Drizzle stub whose single `select(...).limit()` resolves the given rows. */
function makeDb(rows: unknown[]) {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as unknown as PostgresJsDatabase<typeof schemaType>;
}

function makeInteraction() {
  return {
    user: { id: 'discord-user-1' },
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

type Interaction = ReturnType<typeof makeInteraction>;

function cast(interaction: Interaction): ChatInputCommandInteraction {
  return interaction as unknown as ChatInputCommandInteraction;
}

describe('checkBindingPermission (ROK-1628)', () => {
  it('refuses a Discord user with no linked Raid Ledger account', async () => {
    const interaction = makeInteraction();

    const allowed = await checkBindingPermission(makeDb([]), cast(interaction));

    expect(allowed).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'You need a linked Raid Ledger account.',
    );
  });

  it('refuses a linked member and names the requirement', async () => {
    const interaction = makeInteraction();
    const db = makeDb([{ id: 7, role: 'member' }]);

    const allowed = await checkBindingPermission(db, cast(interaction));

    expect(allowed).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringMatching(/operator/i),
    );
  });

  it('allows an operator without replying', async () => {
    const interaction = makeInteraction();
    const db = makeDb([{ id: 8, role: 'operator' }]);

    const allowed = await checkBindingPermission(db, cast(interaction));

    expect(allowed).toBe(true);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('allows an admin without replying', async () => {
    const interaction = makeInteraction();
    const db = makeDb([{ id: 9, role: 'admin' }]);

    const allowed = await checkBindingPermission(db, cast(interaction));

    expect(allowed).toBe(true);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const ACTIVE = {
  bannedAt: null,
  banReason: null,
  kickedAt: null,
  deactivatedAt: null,
};

/** Run either check against one user row; returns the result + reply mock. */
type Check = (
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
) => Promise<boolean>;

const CHECKS: [string, Check, Record<string, unknown>][] = [
  [
    'checkBindingPermission (admin)',
    (db, i) => checkBindingPermission(db, i),
    { id: 9, role: 'admin' },
  ],
  [
    'checkEventPermission (creator)',
    (db, i) => checkEventPermission(db, i, 21),
    { id: 21, role: 'member' },
  ],
];

describe.each(CHECKS)('%s — account state', (_label, check, base) => {
  async function run(state: Record<string, unknown>) {
    const interaction = makeInteraction();
    const db = makeDb([{ ...base, ...ACTIVE, ...state }]);
    const allowed = await check(db, cast(interaction));
    return { allowed, editReply: interaction.editReply };
  }

  it('refuses a banned caller with the suspension copy and reason', async () => {
    const { allowed, editReply } = await run({
      bannedAt: ago(MINUTE),
      banReason: 'spam',
    });
    expect(allowed).toBe(false);
    expect(editReply).toHaveBeenCalledWith(
      'Your account has been suspended: spam',
    );
  });

  it('refuses a banned caller with no reason', async () => {
    const { allowed, editReply } = await run({ bannedAt: ago(MINUTE) });
    expect(allowed).toBe(false);
    expect(editReply).toHaveBeenCalledWith('Your account has been suspended');
  });

  it('refuses a caller kicked 1 minute ago with the cooldown copy', async () => {
    const { allowed, editReply } = await run({ kickedAt: ago(MINUTE) });
    expect(allowed).toBe(false);
    expect(editReply).toHaveBeenCalledWith(
      'Your session was ended by an administrator. You may log in again in 4 minute(s).',
    );
  });

  it('allows a caller whose kick expired 10 minutes ago', async () => {
    const { allowed, editReply } = await run({ kickedAt: ago(10 * MINUTE) });
    expect(allowed).toBe(true);
    expect(editReply).not.toHaveBeenCalled();
  });

  it('refuses a deactivated caller with the rejoin copy', async () => {
    const { allowed, editReply } = await run({ deactivatedAt: ago(MINUTE) });
    expect(allowed).toBe(false);
    expect(editReply).toHaveBeenCalledWith(
      'Your account is inactive — rejoin the Discord server, then try again.',
    );
    expect(BIND_DEACTIVATED_REPLY).toBe(
      'Your account is inactive — rejoin the Discord server, then try again.',
    );
  });

  it('allows an active caller (all state null) without replying', async () => {
    const { allowed, editReply } = await run({});
    expect(allowed).toBe(true);
    expect(editReply).not.toHaveBeenCalled();
  });

  it('allows a row with no state fields (legacy stub shape)', async () => {
    const interaction = makeInteraction();
    const allowed = await check(makeDb([base]), cast(interaction));
    expect(allowed).toBe(true);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('checkEventPermission — non-creator member', () => {
  it('refuses a non-creator member before any state matters', async () => {
    const interaction = makeInteraction();
    const db = makeDb([{ id: 5, role: 'member', ...ACTIVE }]);
    const allowed = await checkEventPermission(db, cast(interaction), 21);
    expect(allowed).toBe(false);
    expect(interaction.editReply).toHaveBeenCalledWith(
      'You can only modify events you created, or you need operator/admin permissions.',
    );
  });
});
