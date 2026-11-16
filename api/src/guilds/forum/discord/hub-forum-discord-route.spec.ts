/**
 * ROK-2208 L5 — pure inbound rules: echo guards (D5), hub routing by tag
 * (§5.4 step 3, OQ-4, AC14), the R8 cut-off (AC13) and body/title shaping.
 */
import {
  EMPTY_BODY,
  inboundBody,
  inboundTitle,
} from './hub-forum-discord-inbound.ingest';
import {
  isEcho,
  pickHub,
  predatesBinding,
  snowflakeTime,
  type RouteBinding,
} from './hub-forum-discord-route';

const EPOCH = 1420070400000n;
const snowAt = (ms: number): string => ((BigInt(ms) - EPOCH) << 22n).toString();

const bound = (guildId: number, tagId: string | null): RouteBinding => ({
  guildId,
  tagId,
  boundAt: new Date('2026-11-16T00:00:00Z'),
});

describe('isEcho (D5)', () => {
  const ctx = { botUserId: 'bot-1', webhookId: 'hook-1' };

  it('drops our own bot user', () => {
    expect(isEcho({ authorId: 'bot-1', webhookId: null }, ctx)).toBe(true);
  });

  it("drops the forum's own webhook", () => {
    expect(isEcho({ authorId: 'hook-1', webhookId: 'hook-1' }, ctx)).toBe(true);
  });

  it('keeps another bot or webhook (R7) and people', () => {
    expect(isEcho({ authorId: 'x', webhookId: 'other-hook' }, ctx)).toBe(false);
    expect(isEcho({ authorId: 'user-9', webhookId: null }, ctx)).toBe(false);
  });

  it('does not treat a null bot id as matching everyone', () => {
    const off = { botUserId: null, webhookId: null };
    expect(isEcho({ authorId: 'user-9', webhookId: null }, off)).toBe(false);
  });
});

describe('pickHub (§5.4 step 3)', () => {
  it('routes a single-hub forum regardless of tags', () => {
    expect(pickHub([bound(1, null)], [])?.guildId).toBe(1);
  });

  it('routes a shared forum by exactly one hub tag', () => {
    const shared = [bound(1, 't1'), bound(2, 't2')];
    expect(pickHub(shared, ['t2', 'other'])?.guildId).toBe(2);
  });

  it('AC14: an untagged or non-hub-tagged post in a shared forum is not synced', () => {
    const shared = [bound(1, 't1'), bound(2, 't2')];
    expect(pickHub(shared, [])).toBeNull();
    expect(pickHub(shared, ['other'])).toBeNull();
  });

  it('a post carrying two hub tags is ambiguous and not synced', () => {
    const shared = [bound(1, 't1'), bound(2, 't2')];
    expect(pickHub(shared, ['t1', 't2'])).toBeNull();
  });
});

describe('snowflake time and R8', () => {
  const boundAt = new Date('2026-11-16T12:00:00Z');

  it('decodes a snowflake to its creation time', () => {
    expect(snowflakeTime(snowAt(boundAt.getTime())).toISOString()).toBe(
      boundAt.toISOString(),
    );
  });

  it('AC13: a post created before bound_at predates the binding', () => {
    expect(predatesBinding(snowAt(boundAt.getTime() - 1000), boundAt)).toBe(
      true,
    );
    expect(predatesBinding(snowAt(boundAt.getTime() + 1000), boundAt)).toBe(
      false,
    );
  });
});

describe('inboundBody / inboundTitle (§5.4 step 7)', () => {
  const base = {
    content: '',
    mentions: new Map<string, string>(),
    attachments: [],
  };

  it('rewrites known mentions and keeps unknown ones', () => {
    const mentions = new Map([['42', 'Thrall']]);
    const body = inboundBody({
      ...base,
      content: 'hi <@42> and <@!7>',
      mentions,
    });
    expect(body).toBe('hi @Thrall and <@!7>');
  });

  it('appends attachments and never returns an empty body', () => {
    const attachments = [{ name: 'a.png', url: 'https://cdn/a.png' }];
    expect(inboundBody({ ...base, attachments })).toBe(
      '[attachment: a.png](https://cdn/a.png)',
    );
    expect(inboundBody(base)).toBe(EMPTY_BODY);
  });

  it('truncates a Nitro-length body to 4000 code points', () => {
    expect(
      Array.from(inboundBody({ ...base, content: '😀'.repeat(4100) })),
    ).toHaveLength(4000);
  });

  it('caps titles at 120 and falls back when blank', () => {
    expect(inboundTitle('x'.repeat(130))).toHaveLength(120);
    expect(inboundTitle('   ')).toBe('Discord post');
  });
});
