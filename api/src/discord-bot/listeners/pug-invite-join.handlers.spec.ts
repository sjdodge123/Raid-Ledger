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
import {
  ACCOUNT_BLOCKED_REPLY,
  accountBlockedError,
} from '../../users/discord-account-status.helpers';

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

function buildHarness(
  clickerId: string,
  bannedAt: Date | null = null,
): Harness {
  const db = createDrizzleMock();
  db.limit
    .mockResolvedValueOnce([EVENT])
    .mockResolvedValueOnce([
      { id: 7, discordId: clickerId, bannedAt, deactivatedAt: null },
    ])
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

  it('refuses a banned invitee with the blocked reply and no signup (ROK-2298)', async () => {
    const h = buildHarness(INVITEE, new Date());
    await handleJoinEventButton(h.deps, h.interaction, 'pugcode1');
    expect({
      reply: h.editReply.mock.calls,
      signups: h.signup.mock.calls.length,
      deletes: h.db.delete.mock.calls.length,
    }).toEqual({
      reply: [[{ content: ACCOUNT_BLOCKED_REPLY, components: [] }]],
      signups: 0,
      deletes: 0,
    });
  });

  it('a ban racing the click (signup throws ACCOUNT_BLOCKED) gets the blocked reply (ROK-2298)', async () => {
    const h = buildHarness(INVITEE);
    h.signup.mockRejectedValueOnce(accountBlockedError());
    await handleJoinEventButton(h.deps, h.interaction, 'pugcode1');
    expect(h.editReply.mock.calls.at(-1)).toEqual([
      { content: ACCOUNT_BLOCKED_REPLY },
    ]);
  });
});
