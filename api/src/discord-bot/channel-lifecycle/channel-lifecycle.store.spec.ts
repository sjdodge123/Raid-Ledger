/** ROK-1431 — the unbind hook (D9): only auto-managed game bindings are suppressed. */
import {
  suppressUnboundAutoBindings,
  type LifecycleDb,
} from './channel-lifecycle.store';

function fakeDb(): { db: LifecycleDb; values: jest.Mock } {
  const values = jest.fn().mockReturnValue({
    onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
  });
  const db = { insert: jest.fn().mockReturnValue({ values }) };
  return { db: db as unknown as LifecycleDb, values };
}

const base = {
  guildId: 'g1',
  gameId: 7,
  autoManaged: true,
  recurrenceGroupId: null,
  bindingPurpose: 'game-announcements',
};

describe('suppressUnboundAutoBindings', () => {
  it('inserts an `unbound` suppression for an auto-managed game binding', async () => {
    const { db, values } = fakeDb();
    await suppressUnboundAutoBindings(db, [base]);
    expect(values).toHaveBeenCalledWith({
      guildId: 'g1',
      gameId: 7,
      reason: 'unbound',
    });
  });
  it.each([
    ['manual', { autoManaged: false }],
    ['series', { recurrenceGroupId: 'rg' }],
    ['no game', { gameId: null }],
    ['other purpose', { bindingPurpose: 'general-lobby' }],
  ])('skips a %s binding', async (_label, patch) => {
    const { db, values } = fakeDb();
    await suppressUnboundAutoBindings(db, [{ ...base, ...patch }]);
    expect(values).not.toHaveBeenCalled();
  });
});
