import {
  diffPings,
  isPingEligible,
  mentionMessages,
  MENTION_PREFIX,
  pingedSetKey,
  signupPingDiscordIds,
  signupPingJobId,
} from './hub-forum-discord-signup-pings';

const snowflake = (n: number): string =>
  String(100000000000000000n + BigInt(n));

describe('ROK-2260 signup pings — eligibility', () => {
  it('pings signed_up and tentative, never declined / roached_out / departed', () => {
    expect(isPingEligible('signed_up')).toBe(true);
    expect(isPingEligible('tentative')).toBe(true);
    expect(isPingEligible('declined')).toBe(false);
    expect(isPingEligible('roached_out')).toBe(false);
    expect(isPingEligible('departed')).toBe(false);
  });

  it('takes a linked user id over the row id, keeps anonymous Discord signups, drops local/unlinked ids and dupes', () => {
    const ids = signupPingDiscordIds([
      { status: 'signed_up', userDiscordId: snowflake(1), discordUserId: null },
      { status: 'tentative', userDiscordId: null, discordUserId: snowflake(2) },
      { status: 'signed_up', userDiscordId: 'local:7', discordUserId: null },
      { status: 'signed_up', userDiscordId: 'unlinked:8', discordUserId: null },
      { status: 'declined', userDiscordId: snowflake(3), discordUserId: null },
      { status: 'signed_up', userDiscordId: snowflake(1), discordUserId: null },
    ]);
    expect(ids).toEqual([snowflake(1), snowflake(2)]);
  });
});

describe('ROK-2260 signup pings — diff against the pinged set', () => {
  it('pings only the new signups and removes only the ones who left', () => {
    const plan = diffPings(['a', 'b', 'c'], ['b', 'c', 'gone']);
    expect(plan).toEqual({ ping: ['a'], remove: ['gone'] });
  });

  it('pings everyone when nothing was pinged yet (first flush / catch-up)', () => {
    expect(diffPings(['a', 'b'], [])).toEqual({ ping: ['a', 'b'], remove: [] });
  });

  it('is a no-op when the set already matches', () => {
    expect(diffPings(['a'], ['a'])).toEqual({ ping: [], remove: [] });
  });
});

describe('ROK-2260 signup pings — one roll-up message, chunked to Discord limits', () => {
  it('mentions every new user in ONE message when they fit', () => {
    const msgs = mentionMessages([snowflake(1), snowflake(2)]);
    expect(msgs).toEqual([
      {
        content: `${MENTION_PREFIX} <@${snowflake(1)}> <@${snowflake(2)}>`,
        userIds: [snowflake(1), snowflake(2)],
      },
    ]);
  });

  it('returns nothing for nobody', () => {
    expect(mentionMessages([])).toEqual([]);
  });

  it('splits at 2000 chars and at 100 mentions, losing nobody', () => {
    const ids = Array.from({ length: 250 }, (_, i) => snowflake(i));
    const msgs = mentionMessages(ids);
    expect(msgs.length).toBeGreaterThan(2);
    for (const m of msgs) {
      expect(m.content.length).toBeLessThanOrEqual(2000);
      expect(m.userIds.length).toBeLessThanOrEqual(100);
      for (const id of m.userIds) expect(m.content).toContain(`<@${id}>`);
    }
    expect(msgs.flatMap((m) => m.userIds)).toEqual(ids);
  });
});

describe('ROK-2260 signup pings — debounce keying', () => {
  it('keys the debounced flush job per event, never with a colon (BullMQ rejects it)', () => {
    expect(signupPingJobId(42)).toBe('forum-signup-pings-42');
    expect(signupPingJobId(42, true)).toBe('forum-signup-pings-42-trail');
    expect(signupPingJobId(42)).not.toContain(':');
    expect(signupPingJobId(42)).not.toBe(signupPingJobId(43));
  });

  it('keys the pinged set per event AND per hub thread (Codex P2-4)', () => {
    const post = { guildId: 7, threadId: 70 };
    expect(pingedSetKey(42, post)).toBe('hub-forum:signup-pings:42:7:70');
    expect(pingedSetKey(42, post)).not.toBe(pingedSetKey(43, post));
    expect(pingedSetKey(42, post)).not.toBe(
      pingedSetKey(42, { guildId: 8, threadId: 70 }),
    );
    expect(pingedSetKey(42, post)).not.toBe(
      pingedSetKey(42, { guildId: 7, threadId: 71 }),
    );
  });
});
