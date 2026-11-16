/**
 * ROK-2208 L4 — the pure outbound mapping: R6 truncation (AC6), the 100-char
 * post title, webhook username rules, absolute avatar URLs and the deep link.
 */
import {
  DISCORD_MESSAGE_MAX,
  READ_MORE_PREFIX,
  WEBHOOK_FALLBACK_USERNAME,
  absoluteAvatarUrl,
  discordThreadName,
  forumThreadUrl,
  truncateForDiscord,
  webhookUsername,
} from './hub-forum-discord-content';

const URL = 'https://rl.example/hubs/7?thread=3#forum';
const LINK = `${READ_MORE_PREFIX}${URL}`;
const LONE_HIGH_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

describe('truncateForDiscord (R6)', () => {
  it('passes a body of exactly 2000 chars through unchanged', () => {
    const body = 'x'.repeat(DISCORD_MESSAGE_MAX);
    expect(truncateForDiscord(body, URL)).toBe(body);
  });

  it('AC6: a 2500-char reply becomes ≤2000 chars ending with the link', () => {
    const body = 'word '.repeat(500);
    const out = truncateForDiscord(body, URL);
    expect(out.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX);
    expect(out.endsWith(`\n\n${LINK}`)).toBe(true);
    expect(out.startsWith('word word')).toBe(true);
    expect(out).not.toMatch(/wor\n/);
  });

  it('cuts at the last paragraph break when one is in the back half', () => {
    const body = `${'a'.repeat(1500)}\n\n${'b'.repeat(1000)}`;
    expect(truncateForDiscord(body, URL)).toBe(
      `${'a'.repeat(1500)}\n\n${LINK}`,
    );
  });

  it('hard-cuts an unbroken body without leaving half an emoji', () => {
    const out = truncateForDiscord('😀'.repeat(1500), URL);
    expect(out.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX);
    expect(LONE_HIGH_SURROGATE.test(out)).toBe(false);
    expect(out.endsWith(LINK)).toBe(true);
  });
});

describe('discordThreadName', () => {
  it('keeps a post title within 100 chars', () => {
    const name = discordThreadName(`${'raid night '.repeat(15)}`);
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith('raid night')).toBe(true);
  });

  it('never sends an empty title', () => {
    expect(discordThreadName('   ')).toBe('Untitled thread');
  });
});

describe('webhookUsername', () => {
  it('uses the RL display name', () => {
    expect(webhookUsername('  Thrall ')).toBe('Thrall');
  });

  it.each([null, '', 'Clyde Fan', 'my discord alt'])(
    'falls back for %p (empty or a name Discord rejects)',
    (name) => {
      expect(webhookUsername(name)).toBe(WEBHOOK_FALLBACK_USERNAME);
    },
  );

  it('caps the name at 80 chars', () => {
    expect(webhookUsername('y'.repeat(120))).toHaveLength(80);
  });
});

describe('absoluteAvatarUrl', () => {
  const client = 'https://rl.test/';

  it('keeps an absolute URL', () => {
    const cdn = 'https://cdn.discordapp.com/avatars/1/a.png';
    expect(absoluteAvatarUrl(cdn, client)).toBe(cdn);
  });

  it('roots a relative upload on the client URL', () => {
    expect(absoluteAvatarUrl('/uploads/a.png', client)).toBe(
      'https://rl.test/uploads/a.png',
    );
  });

  it.each([null, 'a.png'])('omits %p (Discord cannot fetch it)', (url) => {
    expect(absoluteAvatarUrl(url, client)).toBeNull();
  });
});

describe('forumThreadUrl', () => {
  it('deep-links a reply on the hub Forum tab', () => {
    expect(
      forumThreadUrl('https://rl.test/', 7, { threadId: 3, replyId: 9 }),
    ).toBe('https://rl.test/hubs/7?thread=3&reply=9#forum');
  });
});
