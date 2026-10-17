/**
 * ROK-1493 D1/D2 + ROK-1492 D4 — the pure half of "the board owns its forum".
 *
 * Two claims are load-bearing and each needs its own assertion:
 *
 *  - **the reconcile decision is a BITFIELD comparison** (D2). If it compared
 *    object identity or array length, re-flipping the toggle would churn the
 *    audit log on every enable, and an operator's stricter deny would be
 *    fought rather than respected.
 *  - **`SendMessagesInThreads` is touched by neither half** (R2, ruled by the
 *    operator 2026-09-05). Replies inside a bot post are the group's
 *    conversation; a deny that reached them would silence it.
 *
 * A4 (Lead ruling 2026-09-06) is the third: the topic is asserted to CONTAIN
 * the sentinel. Operator text is never overwritten — the sentinel is appended.
 */
import { OverwriteType, PermissionsBitField } from 'discord.js';
import type { PermissionsString } from 'discord.js';
import {
  LFG_BOARD_BOT_ALLOW_FLAGS,
  LFG_BOARD_DENY_FLAGS,
  LFG_BOARD_TOPIC,
  LFG_BOARD_TOPIC_GUIDELINES,
  LFG_BOARD_TOPIC_SENTINEL,
  boardOverwriteEdit,
  boardOverwrites,
  overwritesUpToDate,
  topicHasSentinel,
  topicWithSentinel,
} from './lfg-board-permissions.helpers';
import type { BoardOverwriteHolder } from './lfg-board-permissions.helpers';

const EVERYONE = 'role-everyone';
const BOT = 'bot-1';

/** One resolved overwrite, shaped like discord.js' cached `PermissionOverwrites`. */
function overwrite(
  id: string,
  bits: { allow?: PermissionsString[]; deny?: PermissionsString[] },
): { id: string; allow: PermissionsBitField; deny: PermissionsBitField } {
  return {
    id,
    allow: new PermissionsBitField(bits.allow ?? []),
    deny: new PermissionsBitField(bits.deny ?? []),
  };
}

/** A forum whose overwrite cache holds exactly `entries`. */
function forumWith(
  ...entries: {
    id: string;
    allow: PermissionsBitField;
    deny: PermissionsBitField;
  }[]
): BoardOverwriteHolder {
  return {
    permissionOverwrites: {
      cache: new Map(entries.map((e) => [e.id, e])),
    },
  };
}

const everyoneDeny = () =>
  overwrite(EVERYONE, { deny: [...LFG_BOARD_DENY_FLAGS] });
const botAllow = () =>
  overwrite(BOT, { allow: [...LFG_BOARD_BOT_ALLOW_FLAGS] });

describe('boardOverwrites (D1)', () => {
  it('builds the @everyone deny and the bot allow, with explicit types', () => {
    const built = boardOverwrites(EVERYONE, BOT);

    expect(built).toHaveLength(2);
    expect(built[0]).toEqual({
      id: EVERYONE,
      type: OverwriteType.Role,
      deny: [...LFG_BOARD_DENY_FLAGS],
    });
    expect(built[1]).toEqual({
      id: BOT,
      type: OverwriteType.Member,
      allow: [...LFG_BOARD_BOT_ALLOW_FLAGS],
    });
  });

  // R2 — the operator ruled replies stay open. This is its regression test.
  it('never names SendMessagesInThreads in either half', () => {
    expect(JSON.stringify(boardOverwrites(EVERYONE, BOT))).not.toContain(
      'SendMessagesInThreads',
    );
  });

  // P4 / A5 — an overwrite with an undefined id is an API error.
  it('omits the bot half when the bot user id is unknown', () => {
    const built = boardOverwrites(EVERYONE, null);

    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ id: EVERYONE });
  });
});

describe('boardOverwriteEdit', () => {
  it('turns the deny flags off for @everyone and the allow flags on for the bot', () => {
    expect(boardOverwriteEdit('everyone')).toEqual({
      SendMessages: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    });
    expect(boardOverwriteEdit('bot')).toEqual({
      SendMessages: true,
      CreatePublicThreads: true,
    });
  });

  it('never names SendMessagesInThreads, so replies stay inherited (R2)', () => {
    expect(Object.keys(boardOverwriteEdit('everyone'))).not.toContain(
      'SendMessagesInThreads',
    );
  });
});

describe('overwritesUpToDate (D2)', () => {
  it('reports both halves up to date when the bitfields already carry them', () => {
    const forum = forumWith(everyoneDeny(), botAllow());

    expect(overwritesUpToDate(forum, EVERYONE, BOT)).toEqual({
      everyone: true,
      bot: true,
    });
  });

  it('reports neither half when the forum has no overwrites at all', () => {
    expect(overwritesUpToDate(forumWith(), EVERYONE, BOT)).toEqual({
      everyone: false,
      bot: false,
    });
  });

  it('is per-flag, not per-overwrite: a partial deny is not up to date', () => {
    const forum = forumWith(
      overwrite(EVERYONE, { deny: ['SendMessages'] }),
      botAllow(),
    );

    expect(overwritesUpToDate(forum, EVERYONE, BOT).everyone).toBe(false);
  });

  it('treats a stricter operator deny (a superset) as up to date', () => {
    const forum = forumWith(
      overwrite(EVERYONE, {
        deny: [...LFG_BOARD_DENY_FLAGS, 'AddReactions'],
      }),
      botAllow(),
    );

    expect(overwritesUpToDate(forum, EVERYONE, BOT).everyone).toBe(true);
  });

  it('decides the two halves independently', () => {
    const forum = forumWith(everyoneDeny());

    expect(overwritesUpToDate(forum, EVERYONE, BOT)).toEqual({
      everyone: true,
      bot: false,
    });
  });

  it('ignores an unrelated moderator overwrite', () => {
    const forum = forumWith(
      everyoneDeny(),
      botAllow(),
      overwrite('role-mods', { allow: ['ManageMessages'] }),
    );

    expect(overwritesUpToDate(forum, EVERYONE, BOT)).toEqual({
      everyone: true,
      bot: true,
    });
  });

  it('reports the bot half up to date when the bot user id is unknown', () => {
    const forum = forumWith(everyoneDeny());

    expect(overwritesUpToDate(forum, EVERYONE, null)).toEqual({
      everyone: true,
      bot: true,
    });
  });
});

describe('the topic sentinel (D4 / A4)', () => {
  it('ends the canonical topic with the sentinel line', () => {
    expect(LFG_BOARD_TOPIC.endsWith(LFG_BOARD_TOPIC_SENTINEL)).toBe(true);
    expect(LFG_BOARD_TOPIC).toContain(LFG_BOARD_TOPIC_GUIDELINES);
    expect(LFG_BOARD_TOPIC.length).toBeLessThan(4096);
  });

  it.each([
    [null, false],
    [undefined, false],
    ['', false],
    ['Chat about anything', false],
    [LFG_BOARD_TOPIC, true],
    [`${LFG_BOARD_TOPIC}   \n`, true],
    [`${LFG_BOARD_TOPIC_SENTINEL} trailing words`, true],
  ])('topicHasSentinel(%p) === %p', (topic, expected) => {
    expect(topicHasSentinel(topic)).toBe(expected);
  });

  it.each([null, undefined, '', '   \n '])(
    'writes the guidelines copy when the topic is empty (%p)',
    (topic) => {
      expect(topicWithSentinel(topic)).toBe(LFG_BOARD_TOPIC);
    },
  );

  // A4 — the Lead ruled operator text is preserved, never overwritten.
  it('appends the sentinel to operator text, preserving every word of it', () => {
    const operator = 'Guild rules: no spoilers.\nAsk a mod for a role.';

    const next = topicWithSentinel(operator);

    expect(next.startsWith(operator)).toBe(true);
    expect(next.endsWith(LFG_BOARD_TOPIC_SENTINEL)).toBe(true);
    expect(next).not.toContain(LFG_BOARD_TOPIC_GUIDELINES);
  });

  it('returns a topic that already carries the sentinel unchanged', () => {
    const existing = `Guild rules.\n\n${LFG_BOARD_TOPIC_SENTINEL}`;

    expect(topicWithSentinel(existing)).toBe(existing);
    expect(topicWithSentinel(LFG_BOARD_TOPIC)).toBe(LFG_BOARD_TOPIC);
  });
});
