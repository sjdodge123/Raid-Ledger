/**
 * ROK-1825 — the `pug_join:<code>` button (unfurled on any pasted /i/<code>
 * link) must honour the same invitee binding as the web claim path: a slot
 * reserved for a named Discord user is that user's alone.
 */
import type { ButtonInteraction } from 'discord.js';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import type { PugInviteDeps } from './pug-invite.helpers';
import { handleJoinEventButton } from './pug-invite-join.handlers';

const INVITEE = '555555555555555555';
const STRANGER = '999999999999999999';
const SLOT = {
  id: 'slot-1',
  eventId: 42,
  role: 'dps',
  discordUserId: INVITEE,
};
const EVENT = { id: 42, title: 'Raid Night', cancelledAt: null };

interface Harness {
  deps: PugInviteDeps;
  db: MockDb;
  signup: jest.Mock;
  editReply: jest.Mock;
  interaction: ButtonInteraction;
}

function buildHarness(clickerId: string): Harness {
  const db = createDrizzleMock();
  db.limit
    .mockResolvedValueOnce([EVENT])
    .mockResolvedValueOnce([{ id: 7, discordId: clickerId }])
    .mockResolvedValueOnce([]);
  const signup = jest.fn().mockResolvedValue({});
  const editReply = jest.fn().mockResolvedValue(undefined);
  const deps = {
    db,
    signupsService: { signup },
    pugsService: { findByInviteCode: jest.fn().mockResolvedValue(SLOT) },
    charactersService: {},
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as PugInviteDeps;
  const interaction = {
    id: 'i-1',
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
    user: { id: clickerId, username: 'clicker' },
  } as unknown as ButtonInteraction;
  return { deps, db, signup, editReply, interaction };
}

describe('handleJoinEventButton invitee binding (ROK-1825)', () => {
  it('refuses a non-invitee without signing up or deleting the slot', async () => {
    const h = buildHarness(STRANGER);
    await handleJoinEventButton(h.deps, h.interaction, 'pugcode1');
    expect({
      reply: h.editReply.mock.calls,
      signups: h.signup.mock.calls.length,
      deletes: h.db.delete.mock.calls.length,
    }).toEqual({
      reply: [[{ content: 'This spot is reserved for another player.' }]],
      signups: 0,
      deletes: 0,
    });
  });

  it('lets the reserved invitee join and clears the slot', async () => {
    const h = buildHarness(INVITEE);
    await handleJoinEventButton(h.deps, h.interaction, 'pugcode1');
    expect({
      signup: h.signup.mock.calls,
      deletes: h.db.delete.mock.calls.length,
    }).toEqual({
      signup: [[42, 7, { slotRole: 'dps' }]],
      deletes: 1,
    });
  });
});
