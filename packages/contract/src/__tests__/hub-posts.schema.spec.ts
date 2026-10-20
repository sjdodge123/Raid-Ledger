/**
 * Hub post shapes (ROK-1868): the write-side body (trimmed, 1..4000 SOURCE
 * chars, inside the markdown subset), list paging, strictness and the relay
 * channel union.
 */
import { describe, expect, it } from 'vitest';
import {
  CreateHubPostSchema,
  HUB_POST_BODY_MAX,
  HubPostComposerSchema,
  HubPostListQuerySchema,
  UpdateHubPostSchema,
} from '../hub-posts.schema.js';
import { GUILD_GM_POST_MAX, GuildProfileSchema } from '../guild-content.schema.js';

describe('CreateHubPostSchema', () => {
  it('trims the body', () => {
    const parsed = CreateHubPostSchema.parse({ body: '  hi  ', relayToDiscord: false });
    expect(parsed.body).toBe('hi');
  });

  it.each(['', '   ', 'x'.repeat(HUB_POST_BODY_MAX + 1)])('rejects body of length %#', (body) => {
    expect(CreateHubPostSchema.safeParse({ body, relayToDiscord: true }).success).toBe(false);
  });

  it('accepts exactly 4000 source chars', () => {
    expect(CreateHubPostSchema.safeParse({ body: 'x'.repeat(4000), relayToDiscord: true }).success).toBe(true);
  });

  it('counts markdown markers against the cap', () => {
    const body = `${'**b** '.repeat(4)}${'x'.repeat(3990)}`;
    expect(body.replace(/\*/g, '').length).toBeLessThan(4001);
    expect(CreateHubPostSchema.safeParse({ body, relayToDiscord: false }).success).toBe(false);
  });

  it('refuses HTML with the composer message', () => {
    const r = CreateHubPostSchema.safeParse({ body: '<script>x</script>', relayToDiscord: false });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("Posts can't contain HTML. Use the formatting buttons instead.");
  });

  it('refuses an unsafe link', () => {
    const r = UpdateHubPostSchema.safeParse({ body: '[x](javascript:1)' });
    expect(r.error?.issues[0]?.message).toBe('Links must start with https:// or point to a page on this site.');
  });

  it('is strict and requires relayToDiscord', () => {
    expect(CreateHubPostSchema.safeParse({ body: 'hi' }).success).toBe(false);
    expect(CreateHubPostSchema.safeParse({ body: 'hi', relayToDiscord: false, pinned: true }).success).toBe(false);
  });
});

describe('HubPostListQuerySchema', () => {
  it('defaults to 10 and coerces query strings', () => {
    expect(HubPostListQuerySchema.parse({}).limit).toBe(10);
    expect(HubPostListQuerySchema.parse({ limit: '25' }).limit).toBe(25);
  });

  it.each(['0', '51', '2.5'])('rejects limit %s', (limit) => {
    expect(HubPostListQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});

describe('HubPostComposerSchema', () => {
  it.each([
    { state: 'ok', channelId: '1', channelName: 'general' },
    { state: 'unset' },
    { state: 'disconnected' },
    { state: 'no-permission', channelId: '1', channelName: null },
    { state: 'gone', channelId: '1' },
  ])('accepts channel state $state', (channel) => {
    expect(HubPostComposerSchema.safeParse({ relayDefault: false, channel }).success).toBe(true);
  });

  it('rejects an ok channel without its name', () => {
    const channel = { state: 'ok', channelId: '1' };
    expect(HubPostComposerSchema.safeParse({ relayDefault: true, channel }).success).toBe(false);
  });
});

describe('GuildProfileSchema.latestPost', () => {
  const base = { guildId: 1, gmPost: null, rules: [], links: [] };

  it('is optional, so older servers still parse', () => {
    expect(GuildProfileSchema.safeParse(base).success).toBe(true);
    expect(GuildProfileSchema.safeParse({ ...base, latestPost: null }).success).toBe(true);
  });

  it('keeps the legacy cap equal to the post cap', () => {
    expect(GUILD_GM_POST_MAX).toBe(HUB_POST_BODY_MAX);
  });
});
