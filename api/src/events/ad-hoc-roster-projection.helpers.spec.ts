/**
 * ROK-2323 — pure-logic cases for the ad-hoc / voice roster viewer projection.
 * The controller, gateway and integration specs cover it only indirectly.
 */
import type { AdHocParticipantDto } from '@raid-ledger/contract';
import {
  ANON_SERVER_PLAYER_LABEL,
  toViewerParticipant,
} from './ad-hoc-roster-projection.helpers';

const SNOWFLAKE = '123456789012345678';
const STEAM_ID = '76561198000000001';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function row(over: Partial<AdHocParticipantDto> = {}): AdHocParticipantDto {
  return {
    id: 'row-uuid',
    eventId: 5,
    userId: null,
    discordUserId: SNOWFLAKE,
    discordUsername: 'VoicePlayer',
    discordAvatarHash: 'avatarhash',
    joinedAt: '2026-11-26T10:00:00.000Z',
    leftAt: null,
    totalDurationSeconds: 60,
    sessionCount: 1,
    ...over,
  };
}

/** An unlinked Steam server row whose display name is `name`. */
function anonServerRow(name: string): AdHocParticipantDto {
  return row({
    discordUserId: null,
    discordAvatarHash: null,
    steamId: STEAM_ID,
    playerId: STEAM_ID,
    idKind: 'steam',
    source: 'steam',
    onServer: true,
    discordUsername: name,
  });
}

describe('toViewerParticipant — row id stand-in', () => {
  it('is stable across calls, a v4 UUID, and never contains the snowflake', () => {
    const live = row({ id: SNOWFLAKE });
    const a = toViewerParticipant(live).id;
    const b = toViewerParticipant(live).id;
    expect(a).toBe(b);
    expect(a).toMatch(UUID_V4);
    expect(a).not.toContain(SNOWFLAKE);
  });

  it('differs per event, so one Discord user cannot be correlated across events', () => {
    const one = toViewerParticipant(row({ id: SNOWFLAKE, eventId: 1 })).id;
    const two = toViewerParticipant(row({ id: SNOWFLAKE, eventId: 2 })).id;
    expect(one).not.toBe(two);
  });

  it('keeps a DB row id that is not the Discord id', () => {
    expect(toViewerParticipant(row()).id).toBe('row-uuid');
  });
});

describe('toViewerParticipant — anonymous server player names', () => {
  it.each([
    ['a 17-digit SteamID64', STEAM_ID],
    ['an Xbox XUID', '2535412345678901'],
    ['a Minecraft UUID', '069a79f4-44e9-4726-a5be-fca90e38aaf5'],
  ])('replaces %s used as the name', (_label, name) => {
    const out = toViewerParticipant(anonServerRow(name));
    expect(out.discordUsername).toBe(ANON_SERVER_PLAYER_LABEL);
    expect(JSON.stringify(out)).not.toContain(name);
  });

  it('keeps a character name', () => {
    const out = toViewerParticipant(anonServerRow('Thrall'));
    expect(out.discordUsername).toBe('Thrall');
  });

  it("keeps a linked server player's name even when it looks like an id", () => {
    const linked = { ...anonServerRow(STEAM_ID), userId: 9 };
    expect(toViewerParticipant(linked).discordUsername).toBe(STEAM_ID);
  });
});

describe('toViewerParticipant — Discord detail', () => {
  it('an unlinked voice row loses its Discord id and avatar hash', () => {
    const out = toViewerParticipant(row());
    expect(out).not.toHaveProperty('discordUserId');
    expect(out).toMatchObject({ hasDiscord: true, discordAvatarHash: null });
  });

  it('a linked voice row keeps its Discord id and avatar hash (already public to members)', () => {
    const out = toViewerParticipant(row({ userId: 3 }));
    expect(out).toMatchObject({
      discordUserId: SNOWFLAKE,
      discordAvatarHash: 'avatarhash',
      hasDiscord: true,
    });
  });
});

describe('toViewerParticipant — allow-list', () => {
  it('outputs exactly the allow-listed keys and never a Steam / platform id', () => {
    const full = { ...anonServerRow('Thrall'), inVoice: false };
    expect(Object.keys(toViewerParticipant(full)).sort()).toEqual(
      [
        'discordAvatarHash',
        'discordUsername',
        'eventId',
        'hasDiscord',
        'id',
        'inVoice',
        'joinedAt',
        'leftAt',
        'onServer',
        'sessionCount',
        'source',
        'totalDurationSeconds',
        'userId',
      ].sort(),
    );
  });
});
