import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { colorForState } from '../embeds/embed-chrome.helpers';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  LFG_LIST_CHOICE,
  LFG_LIST_SENTINEL,
  LFG_MAX_WITHDRAW_BUTTONS,
  buildJoinReply,
  buildListReply,
  buildUnknownGameReply,
  forumPostLink,
  formatExpiryLabel,
  lfgAuthorLine,
  parseWithdrawCustomId,
  withdrawCustomId,
  type LfgReplyContext,
} from './lfg.command.helpers';

const CTX: LfgReplyContext = {
  communityName: 'Gamer Night',
  clientUrl: 'https://raid.example',
  timezone: 'UTC',
};

function group(over: Partial<LfgGroupSummaryDto> = {}): LfgGroupSummaryDto {
  return {
    gameId: 42,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    gameCoverUrl: null,
    activeCount: 2,
    state: 'lfm',
    viabilityThreshold: 4,
    isViable: false,
    hasOwnIntent: true,
    soonestExpiresAt: '2026-09-17T10:00:00.000Z',
    ...over,
  };
}

describe('lfgAuthorLine (ROK-1454 D7 vocabulary)', () => {
  it('names the shortfall when the threshold is known and unmet', () => {
    expect(
      lfgAuthorLine(group({ activeCount: 2, viabilityThreshold: 4 })),
    ).toBe('◌ NEEDS PLAYERS · 2 looking · needs 2 more');
  });

  it('omits the shortfall when there is no Co-Optimus threshold (E9)', () => {
    expect(
      lfgAuthorLine(group({ activeCount: 2, viabilityThreshold: null })),
    ).toBe('◌ NEEDS PLAYERS · 2 looking');
  });

  it('switches to READY TO SCHEDULE at viability', () => {
    expect(
      lfgAuthorLine(
        group({ activeCount: 4, viabilityThreshold: 4, isViable: true }),
      ),
    ).toBe('▸ READY TO SCHEDULE · 4 looking');
  });
});

describe('formatExpiryLabel', () => {
  it('renders a plain date, never Discord timestamp markup', () => {
    const label = formatExpiryLabel('2026-09-17T10:00:00.000Z', 'UTC');
    expect(label).toBe('expires 17 Sep');
    expect(label).not.toContain('<t:');
  });

  it('returns null when nothing expires', () => {
    expect(formatExpiryLabel(null, 'UTC')).toBeNull();
  });
});

describe('buildJoinReply (ROK-1454 D11)', () => {
  it('tells the FIRST hand nothing was posted, and names the game', () => {
    const embed = buildJoinReply(
      {
        group: group({ activeCount: 1, state: 'lfg' }),
        created: true,
        memberNames: ['ana'],
      },
      CTX,
    );
    const data = embed.toJSON();
    expect(data.author?.name).toBe("🔎 YOU'RE THE FIRST");
    expect(data.description).toContain(
      'Nobody else is looking for **Deep Rock Galactic** yet',
    );
    expect(data.description).toContain(
      '[Open group ↗](https://raid.example/lfg/deep-rock-galactic)',
    );
    expect(data.footer?.text).toBe('Gamer Night · expires 17 Sep');
    expect(data.color).toBe(colorForState('done'));
  });

  it('renders the roster and the running count on the second hand', () => {
    const embed = buildJoinReply(
      {
        group: group({ activeCount: 2 }),
        created: true,
        memberNames: ['ana', 'bo'],
      },
      CTX,
    );
    const data = embed.toJSON();
    expect(data.author?.name).toBe(
      '◌ NEEDS PLAYERS · 2 looking · needs 2 more',
    );
    expect(data.description).toContain("That's 2 now");
    expect(data.description).toContain('**ana**');
    expect(data.description).toContain('**bo**');
  });

  it('is idempotent-friendly: a repeat hand says already in, not an error', () => {
    const embed = buildJoinReply(
      {
        group: group({ activeCount: 3 }),
        created: false,
        memberNames: ['ana', 'bo', 'cy'],
      },
      CTX,
    );
    const data = embed.toJSON();
    expect(data.description).toContain("You're already in — 3 looking");
    expect(data.description).not.toContain("That's 3 now");
  });

  it('a SOLO repeat reuses the first-hand copy — never "1 looking" beside "Nobody yet"', () => {
    const data = buildJoinReply(
      {
        group: group({ activeCount: 1, state: 'lfg' }),
        created: false,
        memberNames: [],
      },
      CTX,
    ).toJSON();
    expect(data.author?.name).toBe("🔎 YOU'RE THE FIRST");
    expect(data.description).toContain('Nobody else is looking');
    expect(data.description).not.toContain('Nobody yet');
    expect(data.description).not.toContain('1 looking');
  });

  it('never renders an empty description when the roster read came back empty (E8)', () => {
    const embed = buildJoinReply(
      { group: group({ activeCount: 2 }), created: true, memberNames: [] },
      CTX,
    );
    const description = embed.toJSON().description ?? '';
    expect(description.length).toBeGreaterThan(0);
    expect(description).toContain('Nobody yet');
  });

  it('drops the masked link rather than emitting a relative URL with no origin', () => {
    const embed = buildJoinReply(
      { group: group({ activeCount: 1 }), created: true, memberNames: ['ana'] },
      { ...CTX, clientUrl: null },
    );
    expect(embed.toJSON().description).not.toContain('Open group');
  });
});

describe('buildUnknownGameReply', () => {
  it('echoes what the user typed and points at the picker', () => {
    const data = buildUnknownGameReply('drg 2', CTX).toJSON();
    expect(data.description).toBe(
      "I don't know **drg 2** — pick it from the list.",
    );
  });
});

describe('buildListReply (ROK-1454 D11 / AC7)', () => {
  function own(n: number): LfgGroupSummaryDto[] {
    return Array.from({ length: n }, (_, i) =>
      group({ gameId: i + 1, gameName: `Game ${i + 1}`, hasOwnIntent: true }),
    );
  }

  it('lists ONLY the caller’s own groups', () => {
    const { embeds } = buildListReply(
      [
        group({ gameId: 1, gameName: 'Mine', hasOwnIntent: true }),
        group({ gameId: 2, gameName: 'Someone else', hasOwnIntent: false }),
      ],
      CTX,
    );
    const names = (embeds[0].toJSON().fields ?? []).map((f) => f.name);
    expect(names).toEqual(['Mine']);
  });

  it('shows the count and expiry per game, and one withdraw button each', () => {
    const { embeds, components } = buildListReply(own(2), CTX);
    const data = embeds[0].toJSON();
    expect(data.author?.name).toBe('📋 YOUR GROUPS · 2');
    expect(data.fields?.[0]).toMatchObject({
      name: 'Game 1',
      value: '2 looking · expires 17 Sep',
    });
    const ids = components.flatMap((row) =>
      row
        .toJSON()
        .components.map((c) => (c as { custom_id: string }).custom_id),
    );
    expect(ids).toEqual(['lfg:withdraw:1', 'lfg:withdraw:2']);
  });

  it('packs at most five buttons per row', () => {
    const { components } = buildListReply(own(12), CTX);
    expect(components).toHaveLength(3);
    expect(components.map((r) => r.toJSON().components.length)).toEqual([
      5, 5, 2,
    ]);
  });

  // Discord caps an embed at 25 FIELDS as well as 5 rows of 5 buttons, and the
  // overflow notice occupies one field — so an overflowing list shows 24.
  it('stays inside Discord’s 25-field ceiling and says how many are left', () => {
    const { embeds, components } = buildListReply(own(28), CTX);
    const buttonCount = components.reduce(
      (n, row) => n + row.toJSON().components.length,
      0,
    );
    expect(buttonCount).toBe(LFG_MAX_WITHDRAW_BUTTONS - 1);
    expect(components).toHaveLength(5);
    const fields = embeds[0].toJSON().fields ?? [];
    expect(fields).toHaveLength(LFG_MAX_WITHDRAW_BUTTONS);
    expect(fields.map((f) => f.value)).toContain('+4 more on the site');
  });

  it('uses every one of the 25 fields when nothing overflows', () => {
    const { embeds, components } = buildListReply(own(25), CTX);
    expect(embeds[0].toJSON().fields).toHaveLength(25);
    const buttonCount = components.reduce(
      (n, row) => n + row.toJSON().components.length,
      0,
    );
    expect(buttonCount).toBe(LFG_MAX_WITHDRAW_BUTTONS);
  });

  it('tells an empty list how to start one, with no buttons', () => {
    const { embeds, components } = buildListReply([], CTX);
    expect(embeds[0].toJSON().description).toContain(
      "You're not looking for anything right now",
    );
    expect(components).toHaveLength(0);
  });
});

describe('withdraw custom ids', () => {
  it('round-trips a game id', () => {
    expect(withdrawCustomId(42)).toBe('lfg:withdraw:42');
    expect(parseWithdrawCustomId('lfg:withdraw:42')).toBe(42);
  });

  it('refuses the RESERVED join prefix so ROK-1471 cannot be hijacked here', () => {
    expect(parseWithdrawCustomId(`${LFG_BUTTON_IDS.JOIN}:42`)).toBeNull();
  });

  it('refuses a non-numeric or malformed id', () => {
    expect(parseWithdrawCustomId('lfg:withdraw:abc')).toBeNull();
    expect(parseWithdrawCustomId('lfg:withdraw')).toBeNull();
    expect(parseWithdrawCustomId('signup:42')).toBeNull();
  });
});

describe('the list sentinel', () => {
  it('is a non-numeric value so it can never collide with a games.id', () => {
    expect(LFG_LIST_SENTINEL).toBe('list');
    expect(Number.isNaN(Number(LFG_LIST_SENTINEL))).toBe(true);
    expect(LFG_LIST_CHOICE).toEqual({ name: '📋 My groups', value: 'list' });
  });
});

describe('the forum post link (ROK-1471 D8 / AC9)', () => {
  const POST = forumPostLink('guild-1', 'thread-9');

  it('addresses the post by guild id and thread id', () => {
    expect(POST).toBe(
      '[Open the post ↗](https://discord.com/channels/guild-1/thread-9)',
    );
  });

  it('appends the post link to the join confirmation when the group has a thread', () => {
    const embed = buildJoinReply(
      { group: group(), created: true, memberNames: ['ana', 'bo'], postLink: POST },
      CTX,
    );

    const description = embed.toJSON().description ?? '';
    expect(description).toContain(
      '[Open the post ↗](https://discord.com/channels/guild-1/thread-9)',
    );
    // The group-page link is not replaced by it — a player gets both doors.
    expect(description).toContain(
      '[Open group ↗](https://raid.example/lfg/deep-rock-galactic)',
    );
  });

  it('omits it entirely when the group has no thread — board off, text surface, or not yet LFM', () => {
    const withNull = buildJoinReply(
      { group: group(), created: true, memberNames: ['ana', 'bo'], postLink: null },
      CTX,
    ).toJSON().description;
    const without = buildJoinReply(
      { group: group(), created: true, memberNames: ['ana', 'bo'] },
      CTX,
    ).toJSON().description;

    expect(withNull).not.toContain('discord.com/channels');
    // Byte-identical to the 1454 reply: a null thread changes nothing at all.
    expect(withNull).toBe(without);
  });

  it('appends the link to each list row that has a post, and to no other row', () => {
    const { embeds } = buildListReply(
      [
        group({ gameId: 1, gameName: 'Posted', hasOwnIntent: true }),
        group({ gameId: 2, gameName: 'Unposted', hasOwnIntent: true }),
      ],
      CTX,
      new Map([[1, POST]]),
    );

    const fields = embeds[0].toJSON().fields ?? [];
    expect(fields[0].value).toBe(
      '2 looking · expires 17 Sep\n[Open the post ↗](https://discord.com/channels/guild-1/thread-9)',
    );
    expect(fields[1].value).toBe('2 looking · expires 17 Sep');
  });

  it('renders the 1454 rows unchanged when no post links are passed at all', () => {
    const { embeds } = buildListReply(
      [group({ gameId: 1, gameName: 'Posted', hasOwnIntent: true })],
      CTX,
    );

    expect((embeds[0].toJSON().fields ?? [])[0].value).toBe(
      '2 looking · expires 17 Sep',
    );
  });
});
