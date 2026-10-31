/**
 * ROK-1624 AC3 — the WIRING of the EVENT CREATED card, M of N.
 *
 * `lineup-notification-event-roster.helpers.spec.ts` proves the roster helper
 * and the builder each behave; this proves `orchestrateEventCreated` actually
 * hands the builder the roster and not the `findMatchMemberUsers` group it
 * also holds (for the DM fan-out). A one-word regression — passing
 * `members.map((m) => m.displayName)` back in — passes the helper specs and
 * fails here.
 *
 * Only the collaborators outside the card are mocked (visibility routing,
 * channel posting, DM fan-out, the group query); the roster helper and the
 * embed builder run for real against a fake `event_signups` read.
 */
import { orchestrateEventCreated } from './lineup-notification-public-dispatch.helpers';
import type { OrchestrationDeps } from './lineup-notification-public-dispatch.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
} from './lineup-notification-embed.helpers';
import type { MatchInfo } from './lineup-notification.service';
import {
  findMatchMemberUsers,
  isStandaloneLineup,
} from './lineup-notification-targets.helpers';
import { postChannelEmbed } from './lineup-notification-dispatch.helpers';
import { fanOutEventCreatedDMs } from './lineup-notification-dm-batch.helpers';
import * as schema from '../drizzle/schema';

jest.mock('./lineup-notification-routing.helpers', () => ({
  ...jest.requireActual('./lineup-notification-routing.helpers'),
  routeEventCreatedIfPrivate: jest.fn().mockResolvedValue(false),
}));
jest.mock('./lineup-notification-targets.helpers', () => ({
  ...jest.requireActual('./lineup-notification-targets.helpers'),
  findMatchMemberUsers: jest.fn(),
  isStandaloneLineup: jest.fn().mockResolvedValue(false),
}));
jest.mock('./lineup-notification-dispatch.helpers', () => ({
  ...jest.requireActual('./lineup-notification-dispatch.helpers'),
  resolveEmbedCtx: jest.fn(),
  postChannelEmbed: jest.fn(),
}));
jest.mock('./lineup-notification-dm-batch.helpers', () => ({
  ...jest.requireActual('./lineup-notification-dm-batch.helpers'),
  fanOutEventCreatedDMs: jest.fn().mockResolvedValue(undefined),
}));

const EVENT_ID = 77;
/** N = 7 in the group; M = 3 voted for the locked slot and were rostered. */
const ROSTERED = ['bullet33', 'pariah', 'metaveix'];
const NON_VOTERS = ['halfdeadz3dd', 'squidlicker', 'tomato', 'zephyr'];
const GROUP = [...ROSTERED, ...NON_VOTERS].map((displayName, i) => ({
  id: i + 1,
  userId: i + 1,
  displayName,
  discordId: `d-${i + 1}`,
}));

const CTX: EmbedContext = {
  baseUrl: 'https://raid.example',
  lineupId: 1,
  communityName: 'Test Guild',
  phase: 'decided',
  lineupTitle: 'September Lineup',
};

const MATCH = {
  id: 9,
  lineupId: 1,
  gameId: 3,
  gameName: 'Valheim',
} as unknown as MatchInfo;

/** `findEventRosterUsers`' chain; records the table so a match-members read fails. */
function rosterDb(names: string[], maxAttendees: number | null = null) {
  const seen: { fromTable?: unknown } = {};
  const db = {
    select: () => ({
      from: (table: unknown) => {
        return {
          // Record the JOINED select's table (the roster read), so the later
          // event-cap read (ROK-2054) cannot mask a wrong roster source.
          innerJoin: (joined: unknown) => {
            // ROK-2054: the shared occupied-slot count (`isEventAtCapacity`)
            // — every rostered name holds a slot in these cases.
            if (joined === schema.rosterAssignments) {
              return {
                where: () => Promise.resolve([{ count: names.length }]),
              };
            }
            seen.fromTable = table;
            return {
              where: () =>
                Promise.resolve(
                  names.map((displayName, i) => ({
                    userId: i + 1,
                    displayName,
                  })),
                ),
            };
          },
          // ROK-2054: the event-cap read (`.from(events).where().limit(1)`).
          where: () => ({
            limit: () => Promise.resolve([{ slotConfig: null, maxAttendees }]),
          }),
        };
      },
    }),
  };
  return { db, seen };
}

/** Run the orchestrator and return the card it would have posted. */
async function postedCard(
  eventId: number | undefined,
  rostered: string[] = ROSTERED,
  maxAttendees: number | null = null,
) {
  const { db, seen } = rosterDb(rostered, maxAttendees);
  jest.mocked(findMatchMemberUsers).mockResolvedValue(GROUP);
  const { resolveEmbedCtx } = jest.requireMock<
    typeof import('./lineup-notification-dispatch.helpers')
  >('./lineup-notification-dispatch.helpers');
  jest.mocked(resolveEmbedCtx).mockResolvedValue(CTX);
  const out: { card?: EmbedWithRow | null } = {};
  jest.mocked(postChannelEmbed).mockImplementation(async (_d, _k, build) => {
    out.card = await build(CTX);
    return null;
  });
  const deps = {
    db,
    settingsService: { getDefaultTimezone: () => Promise.resolve('UTC') },
  } as unknown as OrchestrationDeps;
  await orchestrateEventCreated(deps, MATCH, new Date(), eventId);
  if (!out.card) throw new Error('orchestrateEventCreated posted no card');
  const fields = out.card.embed.toJSON().fields ?? [];
  return {
    players: fields.find((f) => f.name.includes('Players')),
    description: out.card.embed.toJSON().description ?? '',
    seen,
  };
}

describe('orchestrateEventCreated — card names the roster (ROK-1624 AC1/AC3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names exactly the M rostered players out of an N-person group', async () => {
    const { players, seen } = await postedCard(EVENT_ID);

    expect(seen.fromTable).toBe(schema.eventSignups);
    expect(players?.name).toContain(`Players (${ROSTERED.length})`);
    for (const name of ROSTERED) {
      expect(players?.value).toContain(`**${name}**`);
    }
    for (const name of NON_VOTERS) {
      expect(players?.value).not.toContain(name);
    }
  });

  it('still DMs the whole group — only the card is narrowed to the roster', async () => {
    await postedCard(EVENT_ID);

    const dmMembers = jest.mocked(fanOutEventCreatedDMs).mock.calls[0]?.[6];
    expect(dmMembers?.map((m) => m.displayName)).toEqual(
      GROUP.map((m) => m.displayName),
    );
  });
});

describe('orchestrateEventCreated — "N of M from the group" line (ROK-1863 AC4)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the subtext line when the roster is short of the group', async () => {
    const { players } = await postedCard(EVENT_ID);

    expect(players?.value).toContain(
      `\n*${ROSTERED.length} of ${GROUP.length} from the group signed up*`,
    );
  });

  it('posts no line when the whole group is rostered', async () => {
    const everyone = GROUP.map((m) => m.displayName);
    const { players } = await postedCard(EVENT_ID, everyone);

    expect(players?.name).toContain(`Players (${GROUP.length})`);
    expect(players?.value).not.toContain('from the group signed up');
  });

  it('posts no line without a linked event (names are the group)', async () => {
    const { players } = await postedCard(undefined);

    expect(players?.value).not.toContain('from the group signed up');
  });
});

describe('orchestrateEventCreated — capacity-aware copy (ROK-2054)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the "full" copy when the roster reaches the event cap', async () => {
    const { description } = await postedCard(
      EVENT_ID,
      ROSTERED,
      ROSTERED.length,
    );

    expect(description).toContain(
      'is officially scheduled and full. Join the waitlist on the event page.',
    );
  });

  it('posts the open copy when the event has no cap', async () => {
    const { description } = await postedCard(EVENT_ID, ROSTERED, null);

    expect(description).toContain(
      'is officially scheduled and open for signups.',
    );
  });
});

describe('orchestrateEventCreated — standalone poll (ROK-2054)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts no lineup channel card but still DMs the whole group', async () => {
    jest.mocked(isStandaloneLineup).mockResolvedValueOnce(true);
    jest.mocked(findMatchMemberUsers).mockResolvedValue(GROUP);
    const deps = {
      db: rosterDb(ROSTERED).db,
      settingsService: { getDefaultTimezone: () => Promise.resolve('UTC') },
    } as unknown as OrchestrationDeps;

    await orchestrateEventCreated(deps, MATCH, new Date(), EVENT_ID);

    expect(jest.mocked(postChannelEmbed)).not.toHaveBeenCalled();
    const dmMembers = jest.mocked(fanOutEventCreatedDMs).mock.calls[0]?.[6];
    expect(dmMembers?.map((m) => m.displayName)).toEqual(
      GROUP.map((m) => m.displayName),
    );
  });
});
