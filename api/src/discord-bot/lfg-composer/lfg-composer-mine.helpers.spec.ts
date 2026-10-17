/**
 * ROK-1660 — the intro's `My LFGs` answers the presser privately with their
 * own `/lfg` list and never touches the shared intro message.
 */
import { MessageFlags } from 'discord.js';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { resolveLfgCaller, type LfgCaller } from '../commands/lfg.command';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { showComposerMyLfgs } from './lfg-composer-mine.helpers';

jest.mock('../commands/lfg.command', () => ({
  resolveLfgCaller: jest.fn(),
  loadLfgReplyContext: jest.fn().mockResolvedValue({
    communityName: null,
    clientUrl: null,
    timezone: null,
  }),
  loadLfgPostLinks: jest.fn().mockResolvedValue(new Map()),
}));
const resolveCaller = jest.mocked(resolveLfgCaller);

const caller: LfgCaller = { id: 7, deactivatedAt: null, bannedAt: null };

function group(gameId: number, gameName: string, own: boolean) {
  const dto: LfgGroupSummaryDto = {
    gameId,
    gameName,
    gameSlug: gameName.toLowerCase(),
    gameCoverUrl: null,
    activeCount: 2,
    nowCount: 0,
    state: 'lfg',
    viabilityThreshold: null,
    isViable: false,
    hasOwnIntent: own,
    soonestExpiresAt: null,
    soonestNowExpiresAt: null,
    playingNow: null,
  };
  return dto;
}

function setup(groups: LfgGroupSummaryDto[] = []) {
  const listOwnGroups = jest.fn().mockResolvedValue(groups);
  const deps = {
    db: {} as never,
    lfgService: { listOwnGroups },
    settingsService: {
      getDiscordBotCommunityName: jest.fn().mockResolvedValue(null),
      getClientUrl: jest.fn().mockResolvedValue(null),
      getDiscordBotTimezone: jest.fn().mockResolvedValue(null),
    },
  };
  const interaction = {
    user: { id: 'discord-7' },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    message: { edit: jest.fn().mockResolvedValue(undefined) },
  };
  return { deps, interaction, listOwnGroups };
}

/** The one payload edited into the ephemeral reply. */
function sent(interaction: ReturnType<typeof setup>['interaction']): unknown {
  expect(interaction.editReply).toHaveBeenCalledTimes(1);
  const [payload] = interaction.editReply.mock.calls[0] ?? [];
  return payload;
}

function customIds(payload: unknown): string[] {
  return (
    JSON.stringify(payload)
      .match(/"custom_id":"[^"]+"/g)
      ?.map((m) => m.slice('"custom_id":"'.length, -1)) ?? []
  );
}

beforeEach(() => resolveCaller.mockReset().mockResolvedValue(caller));

describe('showComposerMyLfgs (ROK-1660)', () => {
  it('acknowledges privately before reading anything', async () => {
    const { deps, interaction } = setup();
    await showComposerMyLfgs(deps, interaction as never);
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('lists only own groups, each with its Leave · {game} button', async () => {
    const { deps, interaction, listOwnGroups } = setup([
      group(1, 'Valheim', true),
      group(2, 'Deep Rock', false),
    ]);
    await showComposerMyLfgs(deps, interaction as never);
    expect(listOwnGroups).toHaveBeenCalledWith(7);
    const payload = sent(interaction);
    expect(customIds(payload)).toEqual(['lfg:withdraw:1']);
    expect(JSON.stringify(payload)).toContain('Leave · Valheim');
    expect(JSON.stringify(payload)).not.toContain('Deep Rock');
  });

  it('shows the empty /lfg list when the presser is in nothing', async () => {
    const { deps, interaction } = setup([group(2, 'Deep Rock', false)]);
    await showComposerMyLfgs(deps, interaction as never);
    const payload = sent(interaction);
    expect(JSON.stringify(payload)).toContain(
      "You're not looking for anything right now",
    );
    expect(customIds(payload)).toEqual([]);
  });

  it('tells an unlinked presser to link, and reads no list', async () => {
    resolveCaller.mockResolvedValue(null);
    const { deps, interaction, listOwnGroups } = setup();
    await showComposerMyLfgs(deps, interaction as never);
    expect(sent(interaction)).toBe(LFG_UNLINKED_REPLY);
    expect(listOwnGroups).not.toHaveBeenCalled();
  });

  it.each([
    ['banned', { bannedAt: new Date() }],
    ['deactivated', { deactivatedAt: new Date() }],
  ])('refuses a %s presser', async (_label, patch) => {
    resolveCaller.mockResolvedValue({ ...caller, ...patch });
    const { deps, interaction, listOwnGroups } = setup();
    await showComposerMyLfgs(deps, interaction as never);
    expect(sent(interaction)).toBe(LFG_BLOCKED_REPLY);
    expect(listOwnGroups).not.toHaveBeenCalled();
  });

  it('never edits the shared intro message', async () => {
    const { deps, interaction } = setup([group(1, 'Valheim', true)]);
    await showComposerMyLfgs(deps, interaction as never);
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(interaction.message.edit).not.toHaveBeenCalled();
  });
});
