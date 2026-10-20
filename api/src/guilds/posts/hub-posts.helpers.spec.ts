/**
 * ROK-1868 L2 — pure hub-post helpers: the keyset cursor, the post deep link
 * and the row → contract mapping.
 */
import { BadRequestException } from '@nestjs/common';
import { HubPostSchema } from '@raid-ledger/contract';
import type { HubPostSelect } from '../../drizzle/schema/hub-posts';
import {
  decodeCursor,
  encodeCursor,
  personAvatarUrl,
  postDeepLink,
  toHubPost,
  type HubPostPersonRow,
} from './hub-posts.helpers';

const AT = new Date('2026-10-20T12:34:56.789Z');

function post(over: Partial<HubPostSelect> = {}): HubPostSelect {
  return {
    id: 3,
    guildId: 7,
    body: '**Raid** night',
    authorId: 11,
    createdAt: AT,
    updatedAt: AT,
    updatedBy: null,
    relayChannelId: null,
    relayMessageId: null,
    relayedAt: null,
    ...over,
  };
}

function person(over: Partial<HubPostPersonRow> = {}): HubPostPersonRow {
  return {
    userId: 11,
    username: 'thrall',
    displayName: null,
    avatar: null,
    customAvatarUrl: null,
    discordId: null,
    ...over,
  };
}

describe('encodeCursor / decodeCursor', () => {
  it('round-trips created_at (ms precision) and id', () => {
    const cursor = encodeCursor({ createdAt: AT, id: 42 });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeCursor(cursor);
    expect(back.id).toBe(42);
    expect(back.createdAt.toISOString()).toBe(AT.toISOString());
  });

  it.each([
    ['garbage', 'not-a-cursor!!'],
    ['empty', ''],
    [
      'no separator',
      Buffer.from('2026-10-20T00:00:00.000Z').toString('base64url'),
    ],
    ['bad date', Buffer.from('yesterday|4').toString('base64url')],
    ['bad id', Buffer.from(`${AT.toISOString()}|x4`).toString('base64url')],
    ['zero id', Buffer.from(`${AT.toISOString()}|0`).toString('base64url')],
    [
      'extra part',
      Buffer.from(`${AT.toISOString()}|4|5`).toString('base64url'),
    ],
  ])('rejects a %s cursor with 400', (_label, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(BadRequestException);
  });
});

describe('postDeepLink', () => {
  it('points at the post on the hub Posts tab', () => {
    expect(postDeepLink('https://raid.example', 7, 3)).toBe(
      'https://raid.example/guilds/7?post=3#posts',
    );
  });

  it('drops a trailing slash on the client url', () => {
    expect(postDeepLink('https://raid.example/', 7, 3)).toBe(
      'https://raid.example/guilds/7?post=3#posts',
    );
  });
});

describe('personAvatarUrl', () => {
  it('prefers the custom upload', () => {
    const p = person({
      customAvatarUrl: 'https://x/a.png',
      avatar: 'h',
      discordId: '9',
    });
    expect(personAvatarUrl(p)).toBe('https://x/a.png');
  });

  it('builds the Discord CDN url from id + hash', () => {
    expect(personAvatarUrl(person({ avatar: 'abc', discordId: '9' }))).toBe(
      'https://cdn.discordapp.com/avatars/9/abc.png',
    );
  });

  it('passes an absolute avatar through and is null without one', () => {
    expect(personAvatarUrl(person({ avatar: 'https://y/b.png' }))).toBe(
      'https://y/b.png',
    );
    expect(personAvatarUrl(person({ avatar: 'abc' }))).toBeNull();
    expect(personAvatarUrl(person())).toBeNull();
  });
});

describe('toHubPost', () => {
  it('maps an unedited, unrelayed post to a contract-valid shape', () => {
    const out = toHubPost(
      post(),
      { author: person({ displayName: 'Thrall' }), editor: null },
      null,
    );
    expect(HubPostSchema.parse(out)).toEqual(out);
    expect(out).toMatchObject({
      id: 3,
      guildId: 7,
      body: '**Raid** night',
      createdAt: AT.toISOString(),
      editedBy: null,
      relay: null,
      author: { userId: 11, displayName: 'Thrall', avatarUrl: null },
    });
  });

  it('falls back to the username when no display name is set', () => {
    const out = toHubPost(post(), { author: person(), editor: null }, null);
    expect(out.author.displayName).toBe('thrall');
  });

  it('gives an all-null author once the author is wiped', () => {
    const out = toHubPost(
      post({ authorId: null }),
      { author: null, editor: null },
      null,
    );
    expect(out.author).toEqual({
      userId: null,
      displayName: null,
      avatarUrl: null,
    });
  });
});

describe('toHubPost edit + relay', () => {
  it('marks an edited post with its editor', () => {
    const out = toHubPost(
      post({ updatedBy: 12 }),
      { author: person(), editor: person({ userId: 12, username: 'jaina' }) },
      null,
    );
    expect(out.editedBy).toEqual({
      userId: 12,
      displayName: 'jaina',
      avatarUrl: null,
    });
  });

  it('has no edited marker while updated_by is null (never edited or editor wiped)', () => {
    const at = new Date(AT.getTime() + 60_000);
    const out = toHubPost(
      post({ updatedAt: at }),
      { author: person(), editor: null },
      null,
    );
    expect(out.editedBy).toBeNull();
  });

  it('builds the Discord message url when the bot guild is known', () => {
    const relayed = post({
      relayChannelId: '100',
      relayMessageId: '200',
      relayedAt: AT,
    });
    const known = toHubPost(relayed, { author: person(), editor: null }, '50');
    expect(known.relay).toEqual({
      channelId: '100',
      messageUrl: 'https://discord.com/channels/50/100/200',
      relayedAt: AT.toISOString(),
    });
    const unknown = toHubPost(
      relayed,
      { author: person(), editor: null },
      null,
    );
    expect(unknown.relay?.messageUrl).toBeNull();
    expect(HubPostSchema.parse(known)).toEqual(known);
  });
});
