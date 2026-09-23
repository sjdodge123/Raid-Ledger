/**
 * ROK-1628: the channel paths of `/bind` and `/unbind` change guild-wide
 * routing, so they share one operator/admin check. These cover the helper
 * itself; the command specs cover the call sites.
 */
import { checkBindingPermission } from './bind.resolvers';
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
