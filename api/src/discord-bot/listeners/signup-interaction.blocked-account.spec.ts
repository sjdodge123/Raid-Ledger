/**
 * ROK-2298 — a banned/deactivated linked account pressing an embed signup
 * action (A1–A7) gets the ephemeral blocked reply and no signup write, no
 * status write and no embed re-sync. Active-user paths stay covered by the
 * buttons/menus specs; the "existing row" cleanup (Decline) keeps working.
 */
import { ForbiddenException } from '@nestjs/common';
import { SIGNUP_BUTTON_IDS } from '../discord-bot.constants';
import {
  ACCOUNT_BLOCKED_REPLY,
  accountBlockedError,
} from '../../users/discord-account-status.helpers';
import {
  type SignupInteractionMocks,
  createSignupInteractionTestModule,
  makeButtonInteraction,
  makeChain,
  makeSelectMenuInteraction,
} from './signup-interaction.spec-helpers';
import { _resetCooldowns } from './signup-interaction.helpers';

let mocks: SignupInteractionMocks;
let updateEmbedSpy: jest.SpyInstance;

const BANNED = new Date('2026-11-01T00:00:00Z');

/** Every db select answers with this Discord id's banned user row. */
function seedBlockedUser(discordId: string, flag: 'banned' | 'deactivated') {
  const row = {
    id: 42,
    discordId,
    username: 'Blocked',
    bannedAt: flag === 'banned' ? BANNED : null,
    deactivatedAt: flag === 'deactivated' ? BANNED : null,
  };
  mocks.mockDb.select.mockReturnValue(makeChain([row]));
}

/** A select menu whose deferUpdate flips `deferred`, as discord.js does. */
function selectMenu(customId: string, values: string[], userId: string) {
  const i = makeSelectMenuInteraction(customId, values, userId);
  i.deferUpdate.mockImplementation(() => {
    i.deferred = true;
    return Promise.resolve(undefined);
  });
  return i;
}

function expectNoWrites(): void {
  expect(mocks.mockSignupsService.signup).not.toHaveBeenCalled();
  expect(mocks.mockSignupsService.signupDiscord).not.toHaveBeenCalled();
  expect(mocks.mockSignupsService.updateStatus).not.toHaveBeenCalled();
  expect(updateEmbedSpy).not.toHaveBeenCalled();
}

function expectBlockedReply(i: { editReply: jest.Mock }): void {
  expect(i.editReply).toHaveBeenCalledWith(
    expect.objectContaining({ content: ACCOUNT_BLOCKED_REPLY }),
  );
}

beforeEach(async () => {
  _resetCooldowns();
  mocks = await createSignupInteractionTestModule();
  const target = mocks.listener as unknown as Record<string, () => unknown>;
  updateEmbedSpy = jest
    .spyOn(target, 'updateEmbedSignupCount')
    .mockImplementation(() => Promise.resolve());
});

afterEach(async () => {
  jest.clearAllMocks();
  await mocks.module.close();
});

describe('blocked account — embed buttons (ROK-2298)', () => {
  it.each(['banned', 'deactivated'] as const)(
    'A1 Sign up with no row: %s → blocked reply, no signup',
    async (flag) => {
      seedBlockedUser(`d-a1-${flag}`, flag);
      const i = makeButtonInteraction(
        `${SIGNUP_BUTTON_IDS.SIGNUP}:101`,
        `d-a1-${flag}`,
      );
      await mocks.listener.handleButtonInteraction(i);
      expectBlockedReply(i);
      expectNoWrites();
    },
  );

  it('A2 Sign up on an existing departed row → not reactivated', async () => {
    seedBlockedUser('d-a2', 'banned');
    mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
      id: 1,
      status: 'departed',
      user: { id: 42, discordId: 'd-a2' },
      discordUserId: null,
    });
    const i = makeButtonInteraction(`${SIGNUP_BUTTON_IDS.SIGNUP}:102`, 'd-a2');
    await mocks.listener.handleButtonInteraction(i);
    expectBlockedReply(i);
    expectNoWrites();
  });

  it('A3 Tentative with no row → no tentative signup', async () => {
    seedBlockedUser('d-a3', 'banned');
    const i = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.TENTATIVE}:103`,
      'd-a3',
    );
    await mocks.listener.handleButtonInteraction(i);
    expectBlockedReply(i);
    expectNoWrites();
  });

  it('A4 Tentative on a cancelled row → not re-signed', async () => {
    seedBlockedUser('d-a4', 'deactivated');
    mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
      id: 1,
      status: 'declined',
      user: { id: 42, discordId: 'd-a4' },
      discordUserId: null,
    });
    const i = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.TENTATIVE}:104`,
      'd-a4',
    );
    await mocks.listener.handleButtonInteraction(i);
    expectBlockedReply(i);
    expectNoWrites();
  });

  it('A5 Decline with no row → refused, no declined row (Q4)', async () => {
    seedBlockedUser('d-a5', 'banned');
    const i = makeButtonInteraction(`${SIGNUP_BUTTON_IDS.DECLINE}:105`, 'd-a5');
    await mocks.listener.handleButtonInteraction(i);
    expectBlockedReply(i);
    expect(i.editReply).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: "You've **declined** this event." }),
    );
    expectNoWrites();
  });

  it('AC4 Decline of an EXISTING row still cancels for a blocked user', async () => {
    seedBlockedUser('d-ac4', 'banned');
    mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce({
      id: 1,
      status: 'signed_up',
      user: { id: 42, discordId: 'd-ac4' },
      discordUserId: null,
    });
    const i = makeButtonInteraction(
      `${SIGNUP_BUTTON_IDS.DECLINE}:106`,
      'd-ac4',
    );
    await mocks.listener.handleButtonInteraction(i);
    expect(mocks.mockSignupsService.cancelByDiscordUser).toHaveBeenCalledWith(
      106,
      'd-ac4',
    );
  });
});

describe('blocked account — signup select menus (ROK-2298)', () => {
  it('A6 character select → no signup', async () => {
    seedBlockedUser('d-a6', 'banned');
    const i = selectMenu(
      `${SIGNUP_BUTTON_IDS.CHARACTER_SELECT}:201`,
      ['char-1'],
      'd-a6',
    );
    await mocks.listener.handleSelectMenuInteraction(i);
    expectBlockedReply(i);
    expectNoWrites();
  });

  it('A7 role select carrying a character → no signup', async () => {
    seedBlockedUser('d-a7', 'deactivated');
    const i = selectMenu(
      `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:202:char-1`,
      ['tank'],
      'd-a7',
    );
    await mocks.listener.handleSelectMenuInteraction(i);
    expectBlockedReply(i);
    expectNoWrites();
  });

  it('A7 role select without a character → no signup, no anonymous row', async () => {
    seedBlockedUser('d-a7b', 'banned');
    const i = selectMenu(
      `${SIGNUP_BUTTON_IDS.ROLE_SELECT}:203`,
      ['healer'],
      'd-a7b',
    );
    await mocks.listener.handleSelectMenuInteraction(i);
    expectBlockedReply(i);
    expectNoWrites();
  });
});

describe('listener catch mapping (ROK-2298)', () => {
  it('a service ACCOUNT_BLOCKED refusal shows the blocked reply, not the generic error', async () => {
    mocks.mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
      accountBlockedError(),
    );
    const i = makeButtonInteraction(`${SIGNUP_BUTTON_IDS.SIGNUP}:301`, 'd-c1');
    await mocks.listener.handleButtonInteraction(i);
    expectBlockedReply(i);
  });

  it('any other 403 keeps the generic error copy', async () => {
    mocks.mockSignupsService.findByDiscordUser.mockRejectedValueOnce(
      new ForbiddenException('nope'),
    );
    const i = makeButtonInteraction(`${SIGNUP_BUTTON_IDS.SIGNUP}:302`, 'd-c2');
    await mocks.listener.handleButtonInteraction(i);
    expect(i.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Something went wrong. Please try again.',
      }),
    );
  });
});
