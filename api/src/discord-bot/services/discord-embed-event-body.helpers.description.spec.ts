/**
 * ROK-1804 — the event's own description opens every event embed body.
 *
 * Operator report: "Elder prep — Valheim" had a description, and the FILLING
 * announce embed did not show it.
 */
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import { buildEventBody } from './discord-embed-event-body.helpers';
import {
  EMBED_DESCRIPTION_LIMIT,
  eventDescriptionExcerpt,
} from './discord-embed-event-description.helpers';
import type { EmbedEventData } from './discord-embed.factory';

const DESCRIPTION = 'Bring frost resist, meet at the portal.';
const ROSTER = '**Ana** · **Bo**';

const baseEvent: EmbedEventData = {
  id: 42,
  title: 'Elder prep — Valheim',
  startTime: '2026-10-20T20:00:00.000Z',
  endTime: '2026-10-20T22:00:00.000Z',
  signupCount: 2,
  maxAttendees: 8,
};

const SHOWING_STATES: readonly EmbedState[] = [
  EMBED_STATES.POSTED,
  EMBED_STATES.FILLING,
  EMBED_STATES.FULL,
  EMBED_STATES.IMMINENT,
  EMBED_STATES.LIVE,
  EMBED_STATES.COMPLETED,
  EMBED_STATES.CANCELLED,
];

function body(
  state: EmbedState,
  description: string | null | undefined,
  roster: string | null = ROSTER,
): string {
  return buildEventBody(
    { ...baseEvent, ...(description !== undefined ? { description } : {}) },
    { state, clientUrl: 'https://rl.test', roster, eventLink: false },
  );
}

describe('buildEventBody — event description (ROK-1804)', () => {
  it.each(SHOWING_STATES)(
    '%s opens with the description, then a blank line, then the state body',
    (state) => {
      const withDesc = body(state, DESCRIPTION);
      const without = body(state, null);
      expect(withDesc).toBe(`${DESCRIPTION}\n\n${without}`);
    },
  );

  it.each(SHOWING_STATES)(
    '%s without a description renders exactly as before',
    (state) => {
      expect(body(state, null)).toBe(body(state, undefined));
      expect(body(state, null)).not.toContain(DESCRIPTION);
    },
  );

  it.each(SHOWING_STATES)(
    '%s with a whitespace-only description shows nothing extra',
    (state) => {
      expect(body(state, '   \n\t ')).toBe(body(state, null));
    },
  );

  it('FILLING shows the description above the 📆 timing line', () => {
    const lines = body(EMBED_STATES.FILLING, DESCRIPTION).split('\n');
    expect(lines[0]).toBe(DESCRIPTION);
    expect(lines[1]).toBe('');
    expect(lines[2]?.startsWith('\u{1F4C6}')).toBe(true);
  });

  it('RESCHEDULING keeps its poll-only body', () => {
    const withDesc = buildEventBody(
      { ...baseEvent, description: DESCRIPTION },
      { state: EMBED_STATES.RESCHEDULING, eventLink: false },
    );
    expect(withDesc).not.toContain(DESCRIPTION);
    expect(withDesc).toBe(
      'This event is being rescheduled via a scheduling poll.',
    );
  });
});

describe('buildEventBody — description excerpt shaping (ROK-1804)', () => {
  it('trims surrounding whitespace', () => {
    const lines = body(EMBED_STATES.POSTED, `  \n${DESCRIPTION}  \n`).split(
      '\n',
    );
    expect(lines[0]).toBe(DESCRIPTION);
  });

  it('truncates a long description to 300 chars ending in …', () => {
    const first = body(EMBED_STATES.FILLING, 'x'.repeat(500)).split('\n')[0];
    expect(first).toBe(`${'x'.repeat(299)}…`);
    expect(first).toHaveLength(300);
  });

  it('escapes @everyone, @here and role mentions', () => {
    const first = body(
      EMBED_STATES.POSTED,
      'Ping @everyone and @here and <@&123456>',
    ).split('\n')[0];
    expect(first).toBe(
      'Ping @\u200Beveryone and @\u200Bhere and <@\u200B&123456>',
    );
  });

  it('keeps the whole body within 4096 chars, shrinking the description first', () => {
    const roster = 'r'.repeat(EMBED_DESCRIPTION_LIMIT - 200);
    const out = body(EMBED_STATES.FILLING, 'd'.repeat(300), roster);
    expect(out.length).toBeLessThanOrEqual(EMBED_DESCRIPTION_LIMIT);
    expect(out).toContain(roster);
    expect(out.startsWith('d')).toBe(true);
    expect(out.split('\n')[0]?.endsWith('…')).toBe(true);
  });

  it('drops the description when the roster leaves no room', () => {
    const roster = 'r'.repeat(EMBED_DESCRIPTION_LIMIT - 10);
    const out = body(EMBED_STATES.FILLING, DESCRIPTION, roster);
    expect(out).toBe(body(EMBED_STATES.FILLING, null, roster));
  });
});

describe('eventDescriptionExcerpt (ROK-1804)', () => {
  it('returns null for null, undefined, empty and whitespace', () => {
    expect(eventDescriptionExcerpt(null)).toBeNull();
    expect(eventDescriptionExcerpt(undefined)).toBeNull();
    expect(eventDescriptionExcerpt('')).toBeNull();
    expect(eventDescriptionExcerpt('  \n ')).toBeNull();
  });

  it('leaves a description at exactly 300 chars untouched', () => {
    const exact = 'y'.repeat(300);
    expect(eventDescriptionExcerpt(exact)).toBe(exact);
  });

  it('never splits a surrogate pair when truncating', () => {
    const out = eventDescriptionExcerpt(`${'a'.repeat(298)}\u{1F600}tail`);
    expect(out).toBe(`${'a'.repeat(298)}…`);
  });
});
