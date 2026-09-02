/**
 * ROK-1459 (slice A) — AC5: lineup chrome parity.
 *
 * BASELINE SPEC — this file is expected to PASS on origin/main. It snapshots
 * the colour / author / footer / timestamp / breadcrumb that each of the nine
 * lineup builders emits TODAY, so the migration of `applyChrome()` onto the
 * shared `applyEmbedChrome()` helper (spec §2) is provably byte-identical.
 *
 * Expected values are hard-coded hex literals ON PURPOSE: `EMBED_COLORS` is
 * itself edited by this story, so importing the constant would make the parity
 * assertion circular.
 *
 * If a test here goes red during slice A, the chrome migration changed
 * observable output — fix the migration, never the expectation.
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

/** Pre-change palette values, pinned as literals (see file header). */
const ANNOUNCEMENT_CYAN = 0x38bdf8;
const SIGNUP_EMERALD = 0x34d399;
const ERROR_RED = 0xef4444;

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
}

const CASES: ParityCase[] = [
  {
    builder: 'buildCreatedEmbed',
    build: (c) => buildCreatedEmbed(c, DEADLINE),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Nominations Open',
  },
  {
    builder: 'buildMilestoneEmbed',
    build: (c) => buildMilestoneEmbed(c, 50, NOMINATIONS),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Nomination Milestone',
  },
  {
    builder: 'buildVotingOpenEmbed',
    build: (c) =>
      buildVotingOpenEmbed(c, [{ id: 1, name: 'Deep Rock' }], DEADLINE),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Voting Open',
  },
  {
    builder: 'buildDecidedEmbed',
    build: (c) => buildDecidedEmbed(c, MATCHES),
    color: SIGNUP_EMERALD,
    footerLabel: 'Matches Decided',
  },
  {
    builder: 'buildSchedulingEmbed',
    build: (c) => buildSchedulingEmbed(c, 'Deep Rock', 7),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Scheduling',
  },
  {
    builder: 'buildEventCreatedEmbed',
    build: (c) =>
      buildEventCreatedEmbed(c, 'Deep Rock', 1, DEADLINE, 99, ['Ana', 'Bo']),
    color: SIGNUP_EMERALD,
    footerLabel: 'Event Created',
  },
  {
    builder: 'buildTiebreakerStartedEmbed',
    build: (c) => buildTiebreakerStartedEmbed(c, 'bracket', DEADLINE),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Tiebreaker',
  },
  {
    builder: 'buildTiebreakerReminderEmbed',
    build: (c) => buildTiebreakerReminderEmbed(c, 'veto', DEADLINE, '1h'),
    color: ANNOUNCEMENT_CYAN,
    footerLabel: 'Tiebreaker Reminder',
  },
  {
    builder: 'buildAbortedEmbed',
    build: (c) => buildAbortedEmbed(c, 'not enough players', 'Admin Ana'),
    color: ERROR_RED,
    footerLabel: 'Aborted',
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
    '%s authors as the community name',
    (_name, testCase) => {
      expect(testCase.build(ctx()).embed.toJSON().author?.name).toBe(COMMUNITY);
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
    '%s falls back to "Raid Ledger" when the community name is blank',
    (_name, testCase) => {
      const json = testCase.build(ctx({ communityName: '' })).embed.toJSON();
      expect(json.author?.name).toBe('Raid Ledger');
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
