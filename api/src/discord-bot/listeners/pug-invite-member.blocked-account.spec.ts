/**
 * ROK-2298 B2/B3 — a member-invite DM (Accept button, character select, role
 * select) clicked by a banned or deactivated linked account gets the blocked
 * reply and never reaches `SignupsService`. Active-user controls prove the
 * guard is what stops the blocked clicks, not a missing mock.
 */
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { ACCOUNT_BLOCKED_REPLY } from '../../users/discord-account-status.helpers';
import { MEMBER_INVITE_BUTTON_IDS } from '../discord-bot.constants';
import type { PugInviteDeps } from './pug-invite.helpers';
import { handleMemberInviteButton } from './pug-invite-member.handlers';
import {
  handleMemberCharacterSelectMenu,
  handleMemberRoleSelectMenu,
} from './pug-invite-member-select.handlers';

const CLICKER = '229800000000000001';
const BLOCKED_REPLY_CALL = [{ content: ACCOUNT_BLOCKED_REPLY, components: [] }];

type Moderation = { bannedAt: Date | null; deactivatedAt: Date | null };
const ACTIVE: Moderation = { bannedAt: null, deactivatedAt: null };
const BANNED: Moderation = { bannedAt: new Date(), deactivatedAt: null };
const DEACTIVATED: Moderation = { bannedAt: null, deactivatedAt: new Date() };

interface Harness {
  deps: PugInviteDeps;
  db: MockDb;
  signup: jest.Mock;
  findOne: jest.Mock;
  editReply: jest.Mock;
  interaction: ButtonInteraction & StringSelectMenuInteraction;
}

/** The first `limit` read is the clicker's users row (resolveDiscordAccount). */
function buildHarness(moderation: Moderation, values: string[] = []): Harness {
  const db = createDrizzleMock();
  db.limit
    .mockResolvedValueOnce([{ id: 7, discordId: CLICKER, ...moderation }])
    .mockResolvedValue([]);
  const signup = jest.fn().mockResolvedValue({ id: 99 });
  const findOne = jest.fn().mockResolvedValue(null);
  const editReply = jest.fn().mockResolvedValue(undefined);
  const deps = {
    db,
    signupsService: { signup },
    charactersService: { findOne },
    pugsService: {},
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as PugInviteDeps;
  const interaction = {
    id: 'i-1',
    customId: `${MEMBER_INVITE_BUTTON_IDS.ACCEPT}:42:x`,
    values,
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply,
    message: { edit: jest.fn().mockResolvedValue(undefined), embeds: [] },
    user: { id: CLICKER, username: 'clicker' },
  } as unknown as ButtonInteraction & StringSelectMenuInteraction;
  return { deps, db, signup, findOne, editReply, interaction };
}

describe('member invite Accept button refuses blocked accounts (ROK-2298 B2)', () => {
  it.each([
    ['banned', BANNED],
    ['deactivated', DEACTIVATED],
  ])('%s: blocked reply, no event lookup, no signup', async (_l, mod) => {
    const h = buildHarness(mod);
    await handleMemberInviteButton(h.deps, h.interaction);
    expect({
      replies: h.editReply.mock.calls,
      signups: h.signup.mock.calls.length,
      reads: h.db.limit.mock.calls.length,
    }).toEqual({ replies: [BLOCKED_REPLY_CALL], signups: 0, reads: 1 });
  });

  it('active control: passes the guard and looks the event up', async () => {
    const h = buildHarness(ACTIVE);
    await handleMemberInviteButton(h.deps, h.interaction);
    expect({
      replies: h.editReply.mock.calls,
      reads: h.db.limit.mock.calls.length,
    }).toEqual({
      replies: [[{ content: 'This event is no longer available.' }]],
      reads: 2,
    });
  });
});

describe('member invite selects refuse blocked accounts (ROK-2298 B3)', () => {
  it.each([
    ['banned', BANNED],
    ['deactivated', DEACTIVATED],
  ])('%s character select: blocked reply, no character read', async (_l, m) => {
    const h = buildHarness(m, ['char-1']);
    await handleMemberCharacterSelectMenu(h.deps, h.interaction, '42');
    expect({
      replies: h.editReply.mock.calls,
      findOne: h.findOne.mock.calls.length,
      signups: h.signup.mock.calls.length,
    }).toEqual({ replies: [BLOCKED_REPLY_CALL], findOne: 0, signups: 0 });
  });

  it.each([
    ['banned', BANNED],
    ['deactivated', DEACTIVATED],
  ])('%s role select: blocked reply, no signup', async (_l, mod) => {
    const h = buildHarness(mod, ['dps']);
    await handleMemberRoleSelectMenu(h.deps, h.interaction, '42');
    expect({
      replies: h.editReply.mock.calls,
      signups: h.signup.mock.calls.length,
    }).toEqual({ replies: [BLOCKED_REPLY_CALL], signups: 0 });
  });

  it('active control: character select reads the chosen character', async () => {
    const h = buildHarness(ACTIVE, ['char-1']);
    await handleMemberCharacterSelectMenu(h.deps, h.interaction, '42');
    expect(h.findOne.mock.calls.length).toBe(1);
  });

  it('active control: role select signs the user up in that role', async () => {
    const h = buildHarness(ACTIVE, ['dps']);
    await handleMemberRoleSelectMenu(h.deps, h.interaction, '42');
    expect(h.signup.mock.calls).toEqual([[42, 7, { slotRole: 'dps' }]]);
  });
});
