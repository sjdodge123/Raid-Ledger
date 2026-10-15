import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { BindCommand } from './bind.command';
import { buildBindDefinition } from './bind.definition';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { PURPOSE_WITH_EVENT_ERROR, QP_WITH_SERIES_ERROR } from './bind.purpose';

jest.mock('./bind.confirmation', () => ({
  confirmMultiMonitor: jest.fn().mockResolvedValue(true),
}));

const ADMIN = [{ id: 1, role: 'admin' }];
const VALHEIM = [{ id: 42, name: 'Valheim' }];
const SERIES = [{ recurrenceGroupId: 'series-1', title: 'Friday Night' }];

/** Each `.limit()` resolves the next row set: caller, then game, then series. */
function makeDb(rowSets: unknown[][]) {
  const limit = jest.fn();
  for (const rows of rowSets) limit.mockResolvedValueOnce(rows);
  limit.mockResolvedValue([]);
  const where = jest.fn().mockReturnValue({ limit });
  return { select: jest.fn().mockReturnValue({ from: () => ({ where }) }) };
}

function makeInteraction(opts: Record<string, string>, voice = false) {
  return {
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    guildId: 'guild-123',
    user: { id: 'discord-user-1' },
    channel: {
      id: 'CH_B',
      name: 'valheim-qp',
      type: voice ? ChannelType.GuildVoice : ChannelType.GuildText,
    },
    options: {
      getChannel: jest.fn().mockReturnValue(null),
      getString: jest.fn((name: string) => opts[name] ?? null),
    },
  };
}

async function run(
  opts: Record<string, string>,
  rowSets: unknown[][],
  bind?: jest.Mock,
  voice = false,
) {
  const bindMock =
    bind ??
    jest.fn().mockResolvedValue({
      binding: { config: null },
      replacedChannelIds: [],
    });
  const module = await Test.createTestingModule({
    providers: [
      BindCommand,
      {
        provide: ChannelBindingsService,
        useValue: {
          bind: bindMock,
          detectBehavior: jest.fn().mockReturnValue('game-announcements'),
        },
      },
      { provide: DrizzleAsyncProvider, useValue: makeDb(rowSets) },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    ],
  }).compile();
  const interaction = makeInteraction(opts, voice);
  const command = module.get(BindCommand);
  type Param = Parameters<BindCommand['handleInteraction']>[0];
  await command.handleInteraction(interaction as unknown as Param);
  return { interaction, bindMock };
}

function reply(interaction: ReturnType<typeof makeInteraction>): unknown {
  return interaction.editReply.mock.calls.at(-1)?.[0];
}

const QP = { game: 'Valheim', purpose: 'quick-play-announcements' };

describe('/bind purpose (ROK-1768)', () => {
  it('passes the chosen purpose to bind() instead of the detected one', async () => {
    const { interaction, bindMock } = await run(QP, [ADMIN, VALHEIM]);
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(bindMock.mock.calls[0]?.[3]).toBe('quick-play-announcements');
    expect(bindMock.mock.calls[0]?.[4]).toBe(42);
    const payload = reply(interaction) as {
      embeds?: { data: { title?: string } }[];
    };
    expect(payload.embeds?.[0]?.data.title).toBe(
      '#valheim-qp → Quick Play Announcements · Valheim',
    );
  });

  it('keeps the detected purpose when no purpose is chosen', async () => {
    const { bindMock } = await run({ game: 'Valheim' }, [ADMIN, VALHEIM]);
    expect(bindMock.mock.calls[0]?.[3]).toBe('game-announcements');
  });

  it('refuses Quick Play without a game and writes nothing', async () => {
    const { interaction, bindMock } = await run(
      { purpose: 'quick-play-announcements' },
      [ADMIN],
    );
    expect(reply(interaction)).toBe(
      'A Quick Play Announcements binding must have a game.',
    );
    expect(bindMock).not.toHaveBeenCalled();
  });

  it('refuses Quick Play on a voice channel and writes nothing', async () => {
    const { interaction, bindMock } = await run(
      QP,
      [ADMIN, VALHEIM],
      undefined,
      true,
    );
    expect(reply(interaction)).toMatch(/Quick Play Announcements/);
    expect(bindMock).not.toHaveBeenCalled();
  });

  it('refuses Quick Play with a series and writes nothing', async () => {
    const { interaction, bindMock } = await run({ ...QP, series: 'series-1' }, [
      ADMIN,
      VALHEIM,
      SERIES,
    ]);
    expect(reply(interaction)).toBe(QP_WITH_SERIES_ERROR);
    expect(bindMock).not.toHaveBeenCalled();
  });

  it('names the channel that already posts Quick Play on a 409', async () => {
    const bind = jest.fn().mockRejectedValue(
      new ConflictException({
        message: 'taken',
        code: 'BINDING_QP_GAME_TAKEN',
        field: 'gameId',
        channelId: 'CH_A',
      }),
    );
    const { interaction } = await run(QP, [ADMIN, VALHEIM], bind);
    expect(reply(interaction)).toBe(
      'This game already posts Quick Play to <#CH_A>. Remove or edit that binding first.',
    );
  });

  it('gives a member the ROK-1628 refusal before any purpose check', async () => {
    const { interaction, bindMock } = await run(
      { purpose: 'quick-play-announcements' },
      [[{ id: 7, role: 'member' }]],
    );
    expect(reply(interaction)).toBe(
      'Changing channel bindings needs operator/admin permissions.',
    );
    expect(bindMock).not.toHaveBeenCalled();
  });

  it('refuses purpose on /bind event', async () => {
    const { interaction, bindMock } = await run(
      { event: '12', purpose: 'game-announcements' },
      [ADMIN],
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(reply(interaction)).toBe(PURPOSE_WITH_EVENT_ERROR);
    expect(bindMock).not.toHaveBeenCalled();
  });
});

describe('/bind definition — purpose option (ROK-1768)', () => {
  it('offers exactly the two text purposes in the admin form words', () => {
    const def = buildBindDefinition();
    const purpose = def.options?.find((o) => o.name === 'purpose');
    expect(purpose && 'choices' in purpose ? purpose.choices : null).toEqual([
      { name: 'Announcements', value: 'game-announcements' },
      { name: 'Quick Play Announcements', value: 'quick-play-announcements' },
    ]);
    expect(def.default_member_permissions).toBe(
      String(PermissionFlagsBits.ManageGuild),
    );
    expect(def.dm_permission).toBe(false);
  });
});
