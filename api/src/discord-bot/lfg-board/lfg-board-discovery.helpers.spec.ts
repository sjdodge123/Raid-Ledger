/**
 * ROK-1658 — the intro was renamed to advertise the `Post an LFG` button, and
 * live boards (prod included) still carry the old title. Discovery must know
 * BOTH titles, and ownership must still gate both: a member's post under
 * either title is never the board's intro.
 */
import {
  isIntroTitle,
  isLegacyIntroTitle,
  isOwnIntro,
  pickIntro,
  type IntroCandidate,
} from './lfg-board-discovery.helpers';
import {
  DISCORD_THREAD_NAME_MAX,
  LFG_BOARD_INTRO_LEGACY_TITLES,
  LFG_BOARD_INTRO_TITLE,
} from './lfg-board.constants';

const BOT = 'bot-user-1';
const LEGACY = 'How this board works';
/** `ChannelFlags.Pinned`. */
const PINNED = 1 << 1;

function post(
  id: string,
  name: string,
  ownerId: string | null = BOT,
  pinned = false,
): IntroCandidate {
  const flags = pinned ? PINNED : 0;
  return {
    id,
    name,
    ownerId,
    flags: { has: (flag: number) => (flags & flag) === flag },
    pin: () => Promise.resolve(undefined),
  };
}

describe('LFG board intro title (ROK-1658)', () => {
  it('advertises the Post an LFG button inside the intro', () => {
    expect(LFG_BOARD_INTRO_TITLE).toBe(
      '➕ Post an LFG here · How this board works',
    );
    expect(LFG_BOARD_INTRO_TITLE.length).toBeLessThanOrEqual(
      DISCORD_THREAD_NAME_MAX,
    );
  });

  it('keeps the pre-ROK-1658 title as a legacy title', () => {
    expect(LFG_BOARD_INTRO_LEGACY_TITLES).toEqual([LEGACY]);
    expect(isLegacyIntroTitle(LEGACY)).toBe(true);
    expect(isLegacyIntroTitle(LFG_BOARD_INTRO_TITLE)).toBe(false);
  });

  it('recognises the current and the legacy title, nothing else', () => {
    expect(isIntroTitle(LFG_BOARD_INTRO_TITLE)).toBe(true);
    expect(isIntroTitle(LEGACY)).toBe(true);
    expect(isIntroTitle('Deep Rock Galactic')).toBe(false);
  });
});

describe('isOwnIntro (ROK-1658 titles)', () => {
  it('adopts the bot’s own intro under the NEW title', () => {
    expect(isOwnIntro(post('1', LFG_BOARD_INTRO_TITLE), BOT)).toBe(true);
  });

  it('adopts the bot’s own intro under the LEGACY title', () => {
    expect(isOwnIntro(post('1', LEGACY), BOT)).toBe(true);
  });

  it('refuses a member-owned post under either title', () => {
    expect(isOwnIntro(post('1', LFG_BOARD_INTRO_TITLE, 'member-7'), BOT)).toBe(
      false,
    );
    expect(isOwnIntro(post('2', LEGACY, 'member-7'), BOT)).toBe(false);
  });
});

describe('pickIntro (ROK-1658 titles)', () => {
  it('finds a legacy-titled intro, so no second intro is seeded', () => {
    expect(pickIntro([post('900', LEGACY)], BOT)?.id).toBe('900');
  });

  it('ignores member posts under either title', () => {
    const posts = [
      post('100', LEGACY, 'member-7', true),
      post('200', LFG_BOARD_INTRO_TITLE, 'member-8', true),
    ];
    expect(pickIntro(posts, BOT)).toBeNull();
  });

  it('a pinned legacy intro beats an older unpinned new-titled one', () => {
    const posts = [
      post('100', LFG_BOARD_INTRO_TITLE),
      post('900', LEGACY, BOT, true),
    ];
    expect(pickIntro(posts, BOT)?.id).toBe('900');
  });
});
