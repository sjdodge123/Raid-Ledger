/**
 * ROK-1455 T-B1 / T-B1b / T-B3 — the player-invite DM and its decline row.
 *
 * T-B3 is the one that matters: `buildExtraRows` is gated on `payload.eventId`
 * (`notification-embed.buttons.ts:17`), and an invite payload carries a
 * `gameId`. A branch added BELOW that guard is dead code; this test fails on
 * that code, which is the point.
 */
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { LFG_BUTTON_IDS } from '../discord-bot/discord-bot.constants';
import { createDmEmbed } from '../discord-bot/embeds/embed-chrome.helpers';
import { personalizedFieldName } from '../discord-bot/embeds/embed-personalized.helpers';
import { LFG_INVITE_NOTIFICATION_TYPE } from '../lfg/lfg-invite.constants';
import { buildExtraRows } from './notification-embed.buttons';
import { addTypeSpecificFields } from './notification-embed.helpers';
import {
  LFG_INVITE_DECLINE_LABEL,
  LFG_PLAYER_INVITE_MAX_PERSONALIZED,
  LFG_PLAYER_INVITE_REASON_COPY,
  applyLfgPlayerInviteEmbed,
  buildLfgPlayerInviteLines,
  lfgPlayerInviteAuthorLine,
  pickLfgPlayerInviteFields,
} from './notification-embed.lfg-player-invite';

const OWNED = personalizedFieldName('owned');
const HEARTED = personalizedFieldName('hearted');

function fresh() {
  return createDmEmbed({ state: 'announcing', timestamp: false });
}

function customIds(
  rows: ActionRowBuilder<ButtonBuilder>[] | undefined,
): string[] {
  return (rows ?? []).flatMap((row) =>
    row.components.map(
      (b) => (b.data as { custom_id?: string }).custom_id ?? '<no custom id>',
    ),
  );
}

const PAYLOAD = {
  gameId: 7,
  gameSlug: 'deep-rock-galactic',
  gameName: 'Deep Rock Galactic',
  inviterUserId: 3,
  inviterName: 'Karl',
  reasons: ['owns', 'hearted'],
  url: 'https://raid.example/lfg/deep-rock-galactic',
  playtimeMinutes: 8520,
};

describe('lfg_player_invite DM (ROK-1455 D11 / AC6 / AC7)', () => {
  it('T-B1: is a DmEmbed carrying the library field with 142 hrs for 8520 minutes', () => {
    const embed = applyLfgPlayerInviteEmbed(fresh(), PAYLOAD);

    const owned = embed.data.fields?.find((f) => f.name === OWNED);
    expect(owned?.value).toBe('142 hrs played');
  });

  it('T-B1: carries AT MOST two personalized fields, owned before hearted', () => {
    const fields = pickLfgPlayerInviteFields({
      gameName: 'x',
      inviterName: 'y',
      reasons: ['played', 'owns', 'hearted'],
      playtimeMinutes: 60,
    });

    expect(fields.length).toBeLessThanOrEqual(
      LFG_PLAYER_INVITE_MAX_PERSONALIZED,
    );
    expect(fields.map((f) => f.name)).toEqual([OWNED, HEARTED]);
  });

  it('T-B1: omits the library field entirely when playtime is null — never "0 hrs"', () => {
    const embed = applyLfgPlayerInviteEmbed(fresh(), {
      ...PAYLOAD,
      playtimeMinutes: null,
    });

    const names = (embed.data.fields ?? []).map((f) => f.name);
    expect(names).toEqual([HEARTED]);
    expect(JSON.stringify(embed.data.fields)).not.toContain('0 hrs');
  });

  it('T-B1b: the author line names the inviter', () => {
    const embed = applyLfgPlayerInviteEmbed(fresh(), PAYLOAD);

    expect(embed.data.author?.name).toBe(lfgPlayerInviteAuthorLine('Karl'));
    expect(embed.data.author?.name).toContain('Karl');
  });

  it.each(['played', 'owns', 'hearted'] as const)(
    'T-B1b: the description carries the reason copy for %s',
    (reason) => {
      const lines = buildLfgPlayerInviteLines({
        gameName: 'Deep Rock Galactic',
        inviterName: 'Karl',
        reasons: [reason],
      });

      expect(lines.join('\n')).toContain(LFG_PLAYER_INVITE_REASON_COPY[reason]);
    },
  );

  it('keeps the masked group link in the description, and drops the line when there is no url', () => {
    const withUrl = applyLfgPlayerInviteEmbed(fresh(), PAYLOAD);
    const without = applyLfgPlayerInviteEmbed(fresh(), {
      ...PAYLOAD,
      url: undefined,
    });

    expect(withUrl.data.description).toContain(
      '[Join the group](https://raid.example/lfg/deep-rock-galactic)',
    );
    expect(without.data.description).not.toContain('Join the group');
  });

  it('is wired into addTypeSpecificFields under the registered type', () => {
    const embed = fresh();
    addTypeSpecificFields(embed, LFG_INVITE_NOTIFICATION_TYPE, PAYLOAD);

    expect(embed.data.author?.name).toBe(lfgPlayerInviteAuthorLine('Karl'));
  });
});

describe('buildExtraRows for lfg_player_invite (ROK-1455 T-B3 / AC8)', () => {
  it('T-B3: returns the decline row from a payload that has a gameId and NO eventId', () => {
    const rows = buildExtraRows(
      LFG_INVITE_NOTIFICATION_TYPE,
      { gameId: 7 },
      'https://raid.example',
    );

    expect(customIds(rows)).toEqual([`${LFG_BUTTON_IDS.INVITE_DECLINE}:7`]);
    expect((rows?.[0].components[0].data as { label?: string }).label).toBe(
      LFG_INVITE_DECLINE_LABEL,
    );
  });

  it('returns no row when the payload has no usable gameId', () => {
    expect(
      buildExtraRows(LFG_INVITE_NOTIFICATION_TYPE, { gameId: 'x' }, ''),
    ).toBeUndefined();
    expect(buildExtraRows(LFG_INVITE_NOTIFICATION_TYPE, undefined, '')).toBe(
      undefined,
    );
  });
});
