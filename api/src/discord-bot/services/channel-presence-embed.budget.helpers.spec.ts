/**
 * ROK-1446 D11 / AC10 — the character-budget guard.
 *
 * Discord rejects a message whose embeds total more than 6000 characters, and
 * silently truncates nothing: the whole edit fails. `applyBudget` is the last
 * gate before the wire, so it degrades in a fixed order — badge fields first,
 * then the roster cap — and NEVER by dropping a group, because the design's
 * ladder is "rosters cap per group", not "some groups disappear".
 *
 * The ladder fixtures are SYNTHETIC on purpose. A budget test is the easiest
 * kind to write vacuously (assert a degradation against a fixture that never
 * exceeds the threshold), so each rung is built to a measured size and the
 * "really is over budget" assertion is made explicitly with `messageChars`,
 * not assumed.
 */
import { Logger } from '@nestjs/common';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';
import {
  applyBudget,
  DEGRADED_ROSTER_CAP,
  EMPTY_FIELD_VALUE,
  MAX_MESSAGE_EMBEDS,
  MESSAGE_CHAR_BUDGET,
  messageChars,
} from './channel-presence-embed.budget.helpers';
import { buildChannelPresenceEmbeds } from './channel-presence-embed.helpers';
import type { ResolvedRoom, RoomGroup } from './channel-presence-room.helpers';
import type { EmbedContext } from './discord-embed.factory';

/** A group embed whose description scales with the roster cap in force. */
function groupEmbed(descChars: number, badges: boolean): ChannelEmbed {
  const embed = createChannelEmbed({
    state: 'live',
    communityName: 'C',
    authorLine: 'A',
  });
  embed.setTitle('T');
  embed.setDescription('x'.repeat(descChars));
  if (badges) {
    embed.addFields([
      { name: 'Co-op', value: 'y'.repeat(195), inline: true },
      { name: 'Sale', value: 'z'.repeat(195), inline: true },
    ]);
  }
  return embed;
}

/** The grey lead embed, which owns fields the guard must never strip. */
function leadEmbed(): ChannelEmbed {
  const embed = createChannelEmbed({ state: 'done', communityName: 'C' });
  embed.setTitle('L');
  embed.setDescription('2 sessions running.');
  embed.addFields([
    { name: 'In channel · no game detected', value: '**Ana**' },
  ]);
  return embed;
}

/**
 * A render function shaped like the real one: the roster cap it is handed
 * scales every group's description, exactly as `formatRoster(names, cap)` does.
 */
function renderer(groups: number, charsPerCapUnit: number, badges = true) {
  return jest.fn((cap: number): ChannelEmbed[] => [
    leadEmbed(),
    ...Array.from({ length: groups }, () =>
      groupEmbed(cap * charsPerCapUnit, badges),
    ),
  ]);
}

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => void 0);
});

afterEach(() => {
  warn.mockRestore();
});

describe('applyBudget — under the budget', () => {
  it('renders once, changes nothing and stays quiet', () => {
    const render = renderer(2, 50);
    const embeds = applyBudget(render);

    expect(messageChars(embeds)).toBeLessThanOrEqual(MESSAGE_CHAR_BUDGET);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(ROSTER_NAME_CAP);
    expect(embeds[1].data.fields).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('applyBudget — rung 1: badge fields go first', () => {
  it('the fixture really is over budget, and only because of its badges', () => {
    expect(messageChars(renderer(4, 225)(ROSTER_NAME_CAP))).toBeGreaterThan(
      MESSAGE_CHAR_BUDGET,
    );
    expect(messageChars(renderer(4, 225, false)(ROSTER_NAME_CAP))).toBeLessThan(
      MESSAGE_CHAR_BUDGET,
    );
  });

  it('strips group badge fields, keeps the lead’s field and never re-renders', () => {
    const render = renderer(4, 225);
    const embeds = applyBudget(render);

    expect(messageChars(embeds)).toBeLessThanOrEqual(MESSAGE_CHAR_BUDGET);
    expect(render).toHaveBeenCalledTimes(1);
    expect(embeds[0].data.fields).toHaveLength(1);
    expect(embeds.slice(1).flatMap((e) => e.data.fields ?? [])).toEqual([]);
    expect(embeds[1].data.description).toHaveLength(ROSTER_NAME_CAP * 225);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('applyBudget — rung 2: then the roster cap', () => {
  it('the fixture is over budget even with every badge already gone', () => {
    expect(
      messageChars(renderer(5, 250, false)(ROSTER_NAME_CAP)),
    ).toBeGreaterThan(MESSAGE_CHAR_BUDGET);
  });

  it('re-renders at the degraded cap rather than dropping a group', () => {
    const render = renderer(5, 250);
    const embeds = applyBudget(render);

    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith(DEGRADED_ROSTER_CAP);
    expect(embeds).toHaveLength(6);
    expect(embeds[1].data.description).toHaveLength(DEGRADED_ROSTER_CAP * 250);
    expect(messageChars(embeds)).toBeLessThanOrEqual(MESSAGE_CHAR_BUDGET);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('applyBudget — Discord’s hard limits (AC10)', () => {
  it('never hands back more than ten embeds', () => {
    const embeds = applyBudget(() =>
      Array.from({ length: 14 }, () => groupEmbed(10, false)),
    );

    expect(embeds).toHaveLength(MAX_MESSAGE_EMBEDS);
  });

  it('substitutes a placeholder for a field value Discord would reject', () => {
    const embeds = applyBudget(() => {
      const embed = createChannelEmbed({ state: 'done', communityName: 'C' });
      embed.addFields([
        { name: 'In channel · no game detected', value: '' },
        { name: 'Co-op', value: '  ' },
        { name: '+2 more groups', value: '**Valheim**' },
      ]);
      return [embed];
    });

    expect((embeds[0].data.fields ?? []).map((f) => f.value)).toEqual([
      EMPTY_FIELD_VALUE,
      EMPTY_FIELD_VALUE,
      '**Valheim**',
    ]);
  });
});

const CONTEXT: EmbedContext = {
  communityName: 'A Community With A Really Quite Long Name',
  clientUrl: 'https://raid-ledger.example.com',
  timezone: 'UTC',
};
const NOW = Date.parse('2026-09-02T19:00:00Z');
const OPENED_AT = new Date('2026-09-02T18:00:00Z');

/** Discord caps a display name at 32 characters — use all of them. */
function longName(i: number): string {
  return `Player${String(i).padStart(2, '0')}`.padEnd(32, 'x');
}

/** 12 groups, each an evented 40-name roster with hydrated badges. */
function hugeRoom(titleRepeat = 8): ResolvedRoom {
  const groups: RoomGroup[] = Array.from({ length: 12 }, (_, g) => {
    const names = Array.from({ length: 40 }, (_, i) => longName(g * 40 + i));
    const gameName = `Game ${String(g)} ${'Subtitle'.repeat(titleRepeat)}`;
    return {
      gameId: g + 1,
      gameName,
      memberIds: names.map((n) => `u-${n}`),
      memberNames: names,
      qualifying: true,
      eventId: 500 + g,
      eventData: {
        id: 500 + g,
        title: `${gameName} — Quick Play`,
        startTime: '2026-09-02T18:05:00Z',
        endTime: '2026-09-02T21:05:00Z',
        signupCount: names.length,
        signupMentions: names.map((name) => ({
          displayName: name,
          role: null,
          preferredRoles: null,
          status: 'confirmed',
        })),
        game: {
          id: g + 1,
          name: gameName,
          coverUrl: 'https://cdn.example/cover.png',
          badges: { cooptimusOnlineMax: 16, isFreeToPlay: true },
        },
      },
      game: { coverUrl: null, badges: { cooptimusOnlineMax: 16 } },
    };
  });
  return {
    channelId: 'vc-1',
    channelName: 'General Voice Channel With A Long Name',
    memberCount: 480,
    minPlayers: 2,
    groups,
    undetectedNames: Array.from({ length: 40 }, (_, i) => longName(900 + i)),
  };
}

const room = hugeRoom();
const render = (cap: number) =>
  buildChannelPresenceEmbeds(room, CONTEXT, NOW, OPENED_AT, cap);

describe('applyBudget — the real render at its worst case (AC10)', () => {
  it('honours every Discord limit: ten embeds, the char budget, no empty field', () => {
    const embeds = applyBudget(render);

    expect(embeds).toHaveLength(MAX_MESSAGE_EMBEDS);
    expect(messageChars(embeds)).toBeLessThanOrEqual(MESSAGE_CHAR_BUDGET);
    const values = embeds.flatMap((e) =>
      (e.data.fields ?? []).map((f) => f.value),
    );
    expect(values.filter((v) => v.trim() === '')).toEqual([]);
  });

  it('names the groups it could not render rather than dropping them silently', () => {
    const [lead] = applyBudget(render);
    expect((lead.data.fields ?? []).map((f) => f.name)).toContain(
      '+3 more groups',
    );
  });

  // Measured 2026-09-04: the fixture above renders at 4958 characters, so the
  // ladder never fires on it — with nine groups and a six-name roster cap the
  // ordinary render simply cannot reach 5800. The guard earns its place on
  // PATHOLOGICAL data (games with 200-character titles), which is what this
  // case supplies, so the real builders are exercised through both rungs.
  it('degrades the real render, rosters and all, when titles are pathological', () => {
    const pathological = hugeRoom(25);
    const renderBig = (cap: number) =>
      buildChannelPresenceEmbeds(pathological, CONTEXT, NOW, OPENED_AT, cap);

    expect(messageChars(renderBig(ROSTER_NAME_CAP))).toBeGreaterThan(
      MESSAGE_CHAR_BUDGET,
    );

    const embeds = applyBudget(renderBig);

    expect(messageChars(embeds)).toBeLessThanOrEqual(MESSAGE_CHAR_BUDGET);
    expect(embeds).toHaveLength(MAX_MESSAGE_EMBEDS);
    expect(embeds[1].data.description).toContain('+37 more');
    expect(embeds.slice(1).flatMap((e) => e.data.fields ?? [])).toEqual([]);
  });
});
