/**
 * ROK-1459 (slice A) — AC5: lineup chrome parity.
 * ROK-1461 (slice C) — REWRITTEN, deliberately.
 *
 * Slice A froze what the nine lineup builders emitted so the move onto the
 * shared `applyEmbedChrome()` could be proven byte-identical. Slice C then
 * CHANGED that output on purpose (spec `planning-artifacts/specs/ROK-1461.md`,
 * AC1/AC7): the bare community name in the author slot became a
 * state-carrying author line, and the tiebreaker REMINDER moved from the
 * announcing colour to the `needs_you` amber it always should have used.
 *
 * The 58 cases are all still here — none was deleted, none was weakened. The
 * expectations were rewritten to the new grammar, which is the one sanctioned
 * exception to "never edit an expectation", recorded here so a future reader
 * does not mistake it for a test bent to fit a regression.
 *
 * Expected values remain hard-coded literals ON PURPOSE: importing
 * `EMBED_COLORS` or `lineupAuthorLineFor` would make the assertion circular.
 *
 * If a test here goes red, chrome output changed again — fix the change, or
 * come back and rewrite this file as deliberately as slice C did.
 */
import type { EmbedBuilder } from 'discord.js';
import {
  buildCreatedEmbed,
  buildMilestoneEmbed,
  buildVotingOpenEmbed,
  buildDecidedEmbed,
  buildSchedulingEmbed,
  buildEventCreatedEmbed,
  buildTiebreakerStartedEmbed,
  buildTiebreakerReminderEmbed,
  type EmbedContext,
  type MatchSummary,
  type NominationEntry,
} from './lineup-notification-embed.helpers';
import { buildAbortedEmbed } from './lineup-notification-aborted-embed.helpers';

/** Palette values, pinned as literals (see file header). */
const ANNOUNCEMENT_CYAN = 0x38bdf8;
const REMINDER_AMBER = 0xf59e0b;
const SIGNUP_EMERALD = 0x34d399;
const ERROR_RED = 0xef4444;

/** Author-line glyphs, as escapes so a mojibake round-trip cannot weaken them. */
const DIE = '\u{1F3B2}';
const BALLOT = '\u{1F5F3}';
const TROPHY = '\u{1F3C6}';
const CALENDAR = '\u{1F4C5}';
const SOLID = '\u25CF';
const SWORDS = '\u2694\u{FE0F}';
const DOTTED = '\u25CC';
const STOP = '\u{1F6D1}';
const SEP = '\u00B7';

const COMMUNITY = 'Test Guild';
const BREADCRUMB_FIELD_NAME = '\u200B';
const DEADLINE = new Date('2026-09-10T20:00:00.000Z');

function ctx(overrides: Partial<EmbedContext> = {}): EmbedContext {
  return {
    baseUrl: 'https://raid.example',
    lineupId: 42,
    communityName: COMMUNITY,
    phase: 'nominations',
    ...overrides,
  };
}

const NOMINATIONS: NominationEntry[] = [
  { gameId: 1, gameName: 'Deep Rock', nominatorName: 'Ana', coverUrl: null },
  { gameId: 2, gameName: 'Valheim', nominatorName: 'Bo', coverUrl: null },
];

const MATCHES: MatchSummary[] = [
  {
    id: 1,
    gameId: 1,
    gameName: 'Deep Rock',
    thresholdMet: true,
    voteCount: 5,
    status: 'scheduling',
  },
  {
    id: 2,
    gameId: 2,
    gameName: 'Valheim',
    thresholdMet: false,
    voteCount: 2,
    status: 'rallying',
  },
];

interface ParityCase {
  builder: string;
  build: (c: EmbedContext) => { embed: EmbedBuilder };
  color: number;
  footerLabel: string;
  /** ROK-1461: the state-carrying author line that replaced the bare name. */
  author: string;
}

const CASES: ParityCase[] = [
  {
    builder: 'buildCreatedEmbed',
    build: (c) => buildCreatedEmbed(c, DEADLINE),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Nominations Open',
    author: `${DIE} NOMINATIONS OPEN`,
  },
  {
    builder: 'buildMilestoneEmbed',
    build: (c) => buildMilestoneEmbed(c, 50, NOMINATIONS),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Nomination Milestone',
    author: `${DIE} NOMINATIONS OPEN`,
  },
  {
    builder: 'buildVotingOpenEmbed',
    build: (c) =>
      buildVotingOpenEmbed(c, [{ id: 1, name: 'Deep Rock' }], DEADLINE),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Voting Open',
    author: `${BALLOT} VOTING OPEN`,
  },
  {
    builder: 'buildDecidedEmbed',
    build: (c) => buildDecidedEmbed(c, MATCHES),
    color: SIGNUP_EMERALD,
    footerLabel: 'Matches Decided',
    author: `${TROPHY} MATCHES DECIDED`,
  },
  {
    builder: 'buildSchedulingEmbed',
    build: (c) => buildSchedulingEmbed(c, 'Deep Rock', 7),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Scheduling',
    author: `${CALENDAR} SCHEDULING ${SEP} pick a time`,
  },
  {
    builder: 'buildEventCreatedEmbed',
    build: (c) =>
      buildEventCreatedEmbed(c, 'Deep Rock', 1, DEADLINE, 99, ['Ana', 'Bo']),
    color: SIGNUP_EMERALD,
    footerLabel: 'Event Created',
    author: `${SOLID} EVENT CREATED`,
  },
  {
    builder: 'buildTiebreakerStartedEmbed',
    build: (c) => buildTiebreakerStartedEmbed(c, 'bracket', DEADLINE),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Tiebreaker',
    author: `${SWORDS} TIEBREAKER ${SEP} round 1`,
  },
  {
    builder: 'buildTiebreakerReminderEmbed',
    build: (c) => buildTiebreakerReminderEmbed(c, 'veto', DEADLINE, '1h'),
    color: REMINDER_AMBER,
    footerLabel: 'Tiebreaker Reminder',
    author: `${DOTTED} TIEBREAKER`,
  },
  {
    builder: 'buildAbortedEmbed',
    build: (c) => buildAbortedEmbed(c, 'not enough players', 'Admin Ana'),
    color: ERROR_RED,
    footerLabel: 'Aborted',
    author: `${STOP} ABORTED`,
  },
];

describe('lineup embed chrome parity (AC5)', () => {
  it('covers all nine lineup builders', () => {
    expect(CASES).toHaveLength(9);
  });

  it.each(CASES.map((c) => [c.builder, c] as const))(
    '%s keeps its colour',
    (_name, testCase) => {
      expect(testCase.build(ctx()).embed.toJSON().color).toBe(testCase.color);
    },
  );

  it.each(CASES.map((c) => [c.builder, c] as const))(
    '%s authors as its state-carrying line',
    (_name, testCase) => {
      expect(testCase.build(ctx()).embed.toJSON().author?.name).toBe(
        testCase.author,
      );
    },
  );

  it.each(CASES.map((c) => [c.builder, c] as const))(
    '%s footers as "<community> · <label>"',
    (_name, testCase) => {
      expect(testCase.build(ctx()).embed.toJSON().footer?.text).toBe(
        `${COMMUNITY} · ${testCase.footerLabel}`,
      );
    },
  );

  it.each(CASES.map((c) => [c.builder, c] as const))(
    '%s sets a timestamp',
    (_name, testCase) => {
      expect(typeof testCase.build(ctx()).embed.toJSON().timestamp).toBe(
        'string',
      );
    },
  );

  it.each(CASES.map((c) => [c.builder, c] as const))(
    '%s keeps the lineup phase breadcrumb field',
    (_name, testCase) => {
      const fields = testCase.build(ctx()).embed.toJSON().fields ?? [];
      const breadcrumb = fields.find((f) => f.name === BREADCRUMB_FIELD_NAME);
      expect(breadcrumb).toBeDefined();
      expect(breadcrumb?.value).toContain('Nominations');
      expect(breadcrumb?.inline).toBe(false);
    },
  );
});

describe('lineup embed chrome parity — community fallback (AC5)', () => {
  it.each(CASES.map((c) => [c.builder, c] as const))(
    '%s footers as "Raid Ledger" when the community name is blank',
    (_name, testCase) => {
      const json = testCase.build(ctx({ communityName: '' })).embed.toJSON();
      // ROK-1461: the author line no longer carries the community name, so it
      // is unaffected by the fallback — only the footer falls back.
      expect(json.author?.name).toBe(testCase.author);
      expect(json.footer?.text).toBe(`Raid Ledger · ${testCase.footerLabel}`);
    },
  );
});

describe('lineup embed chrome parity — breadcrumb tracks the phase', () => {
  it.each(['nominations', 'voting', 'decided'] as const)(
    'renders the %s phase as the current step',
    (phase) => {
      const fields =
        buildCreatedEmbed(ctx({ phase })).embed.toJSON().fields ?? [];
      const breadcrumb = fields.find((f) => f.name === BREADCRUMB_FIELD_NAME);
      const label = {
        nominations: 'Nominations',
        voting: 'Voting',
        decided: 'Scheduling',
      }[phase];
      expect(breadcrumb?.value).toContain(`**${label}**`);
    },
  );
});
