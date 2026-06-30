import { PermissionFlagsBits } from 'discord.js';
import {
  computeAllowedDiscordIds,
  buildPrivateVoiceOverwrites,
  reconcileMemberOverwrites,
  type RosterSignupRow,
} from './ephemeral-voice.private.helpers';

const CONNECT = PermissionFlagsBits.Connect;
const VIEW = PermissionFlagsBits.ViewChannel;

function row(over: Partial<RosterSignupRow>): RosterSignupRow {
  return {
    assignedSlot: 'dps',
    status: 'signed_up',
    userDiscordId: 'u1',
    signupDiscordUserId: null,
    ...over,
  };
}

describe('computeAllowedDiscordIds (ROK-1386)', () => {
  it('includes rostered signed_up + tentative members', () => {
    const ids = computeAllowedDiscordIds([
      row({ userDiscordId: 'a', status: 'signed_up' }),
      row({ userDiscordId: 'b', status: 'tentative' }),
    ]);
    expect(ids).toEqual(new Set(['a', 'b']));
  });

  it('excludes benched players even when signed_up or tentative', () => {
    const ids = computeAllowedDiscordIds([
      row({ userDiscordId: 'a', status: 'signed_up', assignedSlot: 'bench' }),
      row({ userDiscordId: 'b', status: 'tentative', assignedSlot: 'bench' }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('excludes declined / roached_out / departed statuses', () => {
    const ids = computeAllowedDiscordIds([
      row({ userDiscordId: 'a', status: 'declined' }),
      row({ userDiscordId: 'b', status: 'roached_out' }),
      row({ userDiscordId: 'c', status: 'departed' }),
    ]);
    expect(ids.size).toBe(0);
  });

  it('falls back to signup.discordUserId when users.discordId is null', () => {
    const ids = computeAllowedDiscordIds([
      row({ userDiscordId: null, signupDiscordUserId: 'anon1' }),
    ]);
    expect(ids).toEqual(new Set(['anon1']));
  });

  it('drops rows with no resolvable discord id (unlinked members blocked)', () => {
    const ids = computeAllowedDiscordIds([
      row({ userDiscordId: null, signupDiscordUserId: null }),
      row({ userDiscordId: 'ok' }),
    ]);
    expect(ids).toEqual(new Set(['ok']));
  });
});

describe('buildPrivateVoiceOverwrites (ROK-1386)', () => {
  it('denies Connect for @everyone but keeps it visible', () => {
    const ow = buildPrivateVoiceOverwrites({
      guildId: 'g',
      botId: 'bot',
      allowedDiscordIds: [],
    });
    const everyone = ow.find((o) => o.id === 'g')!;
    expect(everyone.deny).toEqual([CONNECT]);
    expect(everyone.allow).toEqual([VIEW]);
  });

  it('grants the bot Connect + ViewChannel so the deny cannot lock it out', () => {
    const ow = buildPrivateVoiceOverwrites({
      guildId: 'g',
      botId: 'bot',
      allowedDiscordIds: ['m1'],
    });
    const bot = ow.find((o) => o.id === 'bot')!;
    expect(bot.allow).toEqual([CONNECT, VIEW]);
  });

  it('grants each allowed member Connect + ViewChannel', () => {
    const ow = buildPrivateVoiceOverwrites({
      guildId: 'g',
      botId: 'bot',
      allowedDiscordIds: ['m1', 'm2'],
    });
    expect(ow.find((o) => o.id === 'm1')!.allow).toEqual([CONNECT, VIEW]);
    expect(ow.find((o) => o.id === 'm2')!.allow).toEqual([CONNECT, VIEW]);
  });
});

describe('reconcileMemberOverwrites (ROK-1386)', () => {
  it('computes ids to add and stale ids to remove', () => {
    const { toAdd, toRemove } = reconcileMemberOverwrites(
      ['stay', 'stale'],
      new Set(['stay', 'new']),
    );
    expect(toAdd).toEqual(['new']);
    expect(toRemove).toEqual(['stale']);
  });

  it('returns empty diffs when current already matches desired', () => {
    const { toAdd, toRemove } = reconcileMemberOverwrites(
      ['a', 'b'],
      new Set(['a', 'b']),
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });
});
