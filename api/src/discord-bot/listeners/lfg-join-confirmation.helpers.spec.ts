/**
 * ROK-1455 walk feedback 1 & 2 — what a Join press is told back.
 *
 * The operator's verdict on `That's 2 now — Open group ↗` was that it "should
 * probably be more informative than 'thats 2'". These tests pin the two things
 * that made it uninformative AND the two ways a naive fix goes wrong:
 *
 *  - the horizon must come from the JOINER'S OWN hand, not the group aggregate
 *    (a week-hand joiner in a now-group must not be told "right now until …");
 *  - the time must be Discord timestamp markup, never a server-formatted clock.
 */
import { ButtonStyle } from 'discord.js';
import type { LfgIntentResponseDto } from '@raid-ledger/contract';
import { LFG_INVITE_VIEW_LABEL } from '../embeds/lfg-view-group-button.helpers';
import {
  buildLfgJoinConfirmation,
  lfgJoinHorizonClause,
} from './lfg-join-confirmation.helpers';

const CLIENT_URL = 'https://raid.example';
/** 2026-09-08T21:12:00Z — the epoch second the markup must carry. */
const LAPSES_AT = '2026-09-08T21:12:00.000Z';
const LAPSES_AT_UNIX = 1788901920;

function group(over: Record<string, unknown> = {}) {
  return {
    gameId: 42,
    gameName: 'World of Warcraft Classic',
    gameSlug: 'world-of-warcraft-classic',
    gameCoverUrl: null,
    activeCount: 2,
    nowCount: 1,
    state: 'open',
    viabilityThreshold: 4,
    isViable: false,
    hasOwnIntent: true,
    soonestExpiresAt: LAPSES_AT,
    soonestNowExpiresAt: LAPSES_AT,
    ...over,
  };
}

/** `createIntent`'s response body: the caller's OWN hand, plus the group. */
function body(
  over: Record<string, unknown> = {},
  groupOver: Record<string, unknown> = {},
): LfgIntentResponseDto {
  return {
    id: 1,
    userId: 7,
    gameId: 42,
    status: 'active',
    visibility: 'local',
    createdAt: '2026-09-08T20:12:00.000Z',
    expiresAt: LAPSES_AT,
    urgency: 'now',
    ttlMinutes: 60,
    convertedToPollId: null,
    convertedToEventId: null,
    ...over,
    group: group(groupOver),
  } as LfgIntentResponseDto;
}

describe('buildLfgJoinConfirmation — copy (ROK-1455 walk feedback 1/2)', () => {
  const cases: {
    name: string;
    created: boolean;
    body: LfgIntentResponseDto;
    expected: string;
  }[] = [
    {
      name: 'joined on a NOW hand — game, own expiry as Discord markup, count',
      created: true,
      body: body(),
      expected: `You're in — World of Warcraft Classic, right now until <t:${LAPSES_AT_UNIX}:t>. 2 looking.`,
    },
    {
      name: 'joined on a WEEK hand — no clock at all',
      created: true,
      body: body({ urgency: 'week', ttlMinutes: null }),
      expected: "You're in — World of Warcraft Classic, this week. 2 looking.",
    },
    {
      name: 'a WEEK hand raised in a NOW group still reads "this week" — the horizon is the joiner\'s, not the group\'s',
      created: true,
      body: body(
        { urgency: 'week', ttlMinutes: null },
        { nowCount: 3, soonestNowExpiresAt: LAPSES_AT },
      ),
      expected: "You're in — World of Warcraft Classic, this week. 2 looking.",
    },
    {
      name: 'a viable group says so',
      created: true,
      body: body(
        { urgency: 'week', ttlMinutes: null },
        { activeCount: 4, isViable: true },
      ),
      expected:
        "You're in — World of Warcraft Classic, this week. 4 looking — that's enough to play.",
    },
    {
      name: 'repeat press keeps the shape and only changes the lead-in (E10)',
      created: false,
      body: body(),
      expected: `You're already in — World of Warcraft Classic, right now until <t:${LAPSES_AT_UNIX}:t>. 2 looking.`,
    },
    {
      name: 'a NOW hand with a MISSING expiry degrades to "right now" — never an empty timestamp',
      created: true,
      body: body({ expiresAt: null }),
      expected: "You're in — World of Warcraft Classic, right now. 2 looking.",
    },
    {
      name: 'a NOW hand with an UNPARSEABLE expiry degrades the same way — never "Invalid Date"',
      created: true,
      body: body({ expiresAt: 'not-a-date' }),
      expected: "You're in — World of Warcraft Classic, right now. 2 looking.",
    },
  ];

  it.each(cases)('$name', ({ created, body: b, expected }) => {
    const built = buildLfgJoinConfirmation({ created, body: b }, CLIENT_URL);

    expect(built.content).toBe(expected);
    expect(built.content).not.toContain('Invalid Date');
    expect(built.content).not.toMatch(/<t:(NaN|undefined|null)?:/u);
  });

  it('drops the horizon clause entirely when the joiner has no readable hand', () => {
    const built = buildLfgJoinConfirmation(
      { created: true, body: body({ urgency: undefined }) },
      CLIENT_URL,
    );

    expect(built.content).toBe(
      "You're in — World of Warcraft Classic. 2 looking.",
    );
  });

  it('renders the time as Discord markup, not a server-formatted clock', () => {
    const built = buildLfgJoinConfirmation(
      { created: true, body: body() },
      CLIENT_URL,
    );

    expect(built.content).toContain(`<t:${LAPSES_AT_UNIX}:t>`);
    // A server-side format of the same instant would read like "9:12 PM"
    // (or "21:12") — wrong for every reader outside the server's zone.
    expect(built.content).not.toMatch(/\d{1,2}:\d{2}/u);
  });
});

describe('lfgJoinHorizonClause', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    [{ urgency: 'week', expiresAt: LAPSES_AT }, ', this week'],
    [{ urgency: 'now', expiresAt: null }, ', right now'],
    [
      { urgency: 'now', expiresAt: LAPSES_AT },
      `, right now until <t:${LAPSES_AT_UNIX}:t>`,
    ],
  ])('%p -> %p', (intent, expected) => {
    expect(
      lfgJoinHorizonClause(
        intent as Parameters<typeof lfgJoinHorizonClause>[0],
      ),
    ).toBe(expected);
  });
});

describe('buildLfgJoinConfirmation — the View button (walk feedback 4)', () => {
  it('carries ONE link-style button, labelled from the DM card’s own constant', () => {
    const built = buildLfgJoinConfirmation(
      { created: true, body: body() },
      CLIENT_URL,
    );

    expect(built.components).toHaveLength(1);
    const buttons = built.components[0].toJSON().components;
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toMatchObject({
      style: ButtonStyle.Link,
      label: LFG_INVITE_VIEW_LABEL,
      url: `${CLIENT_URL}/lfg/world-of-warcraft-classic`,
    });
  });

  it('no longer inlines the masked "Open group ↗" link the walk complained about', () => {
    const built = buildLfgJoinConfirmation(
      { created: true, body: body() },
      CLIENT_URL,
    );

    expect(built.content).not.toContain('Open group');
    // Any masked link at all — the reply is a button now, not markdown.
    expect(built.content).not.toMatch(/\[[^\]]+\]\(https?:/u);
    expect(built.content).not.toContain(CLIENT_URL);
  });

  it('omits the button rather than pointing it nowhere when the client URL is unset', () => {
    const built = buildLfgJoinConfirmation(
      { created: true, body: body() },
      null,
    );

    expect(built.components).toEqual([]);
    expect(built.content).toBe(
      `You're in — World of Warcraft Classic, right now until <t:${LAPSES_AT_UNIX}:t>. 2 looking.`,
    );
  });
});
