/**
 * ROK-1462 (slice D) — DM grammar for the three invite builders.
 *
 * The DM copy was unpinned before this slice (audit §2): the builders had no
 * spec at all, so every assertion here is new rather than a rewritten pin.
 * Covers AC1 (PUG invite) and AC2 (member invite + creator relay).
 */
import { ButtonStyle } from 'discord.js';
import {
  buildPugInviteEmbed,
  buildMemberInviteEmbed,
  buildInviteRelayEmbed,
} from './pug-invite.helpers';
import { EMBED_COLORS } from '../discord-bot.constants';
import {
  PERSONALIZED_FIELD_NAMES,
  personalizedFieldName,
} from '../embeds/embed-personalized.helpers';
import type * as schema from '../../drizzle/schema';

const OWNED_FIELD = personalizedFieldName('owned');
const WISHLIST_FIELD = personalizedFieldName('wishlist');
const HEARTED_FIELD = personalizedFieldName('hearted');

const NOW = Date.UTC(2026, 8, 4, 19, 20); // 2026-09-04T19:20Z
const START = new Date(Date.UTC(2026, 8, 4, 20, 0)); // 40 minutes later
const END = new Date(Date.UTC(2026, 8, 4, 22, 0));

function makeEvent(
  overrides: Partial<typeof schema.events.$inferSelect> = {},
): typeof schema.events.$inferSelect {
  return {
    id: 42,
    title: 'Deep Rock Galactic — Friday Deep Dive',
    gameId: 7,
    maxAttendees: 8,
    duration: [START, END],
    ...overrides,
  } as unknown as typeof schema.events.$inferSelect;
}

function pugInput(overrides: Record<string, unknown> = {}) {
  return {
    pugSlotId: 'slot-1',
    eventId: 42,
    event: makeEvent(),
    communityName: 'Test Guild',
    clientUrl: 'https://rl.example',
    voiceChannelId: null,
    role: 'healer',
    signupCount: 7,
    now: NOW,
    ...overrides,
  };
}

describe('buildPugInviteEmbed (AC1)', () => {
  it('renders the DM chrome: amber, FILL NEEDED author, linked title', () => {
    const { embed } = buildPugInviteEmbed(pugInput());
    const data = embed.toJSON();

    expect(data.color).toBe(EMBED_COLORS.REMINDER);
    expect(data.author?.name).toBe('◌ FILL NEEDED · starts in 40 min');
    expect(data.title).toBe('Deep Rock Galactic — Friday Deep Dive');
    expect(data.url).toBe('https://rl.example/games/7');
    expect(data.footer?.text).toBe('Test Guild · healer');
  });

  it('leaves the title unlinked when the event has no game', () => {
    const { embed } = buildPugInviteEmbed(
      pugInput({ event: makeEvent({ gameId: null }) }),
    );
    expect(embed.toJSON().url).toBeUndefined();
  });

  it('describes the open spot, the roster count and the start time', () => {
    const { embed } = buildPugInviteEmbed(pugInput());
    const desc = embed.toJSON().description ?? '';

    expect(desc).toContain('1 spot open · 7 of 8 signed up');
    expect(desc).toContain(
      `\u{1F4C5} <t:${Math.floor(START.getTime() / 1000)}:F>`,
    );
  });

  it('carries NO masked event link in the description (D1 link rule)', () => {
    const { embed } = buildPugInviteEmbed(pugInput());
    const desc = embed.toJSON().description ?? '';

    expect(desc).not.toContain('](');
    expect(desc).not.toContain('/events/42');
    expect(desc).not.toContain('Event details');
  });

  it('offers Accept, Decline and a View Event link button', () => {
    const { row } = buildPugInviteEmbed(pugInput());
    const buttons = row?.toJSON().components ?? [];

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toMatchObject({ label: 'Accept' });
    expect(buttons[1]).toMatchObject({ label: 'Decline' });
    expect(buttons[2]).toMatchObject({
      label: 'View Event',
      style: ButtonStyle.Link,
      url: 'https://rl.example/events/42',
    });
  });

  it('drops the View Event button when no client URL is configured', () => {
    const { row } = buildPugInviteEmbed(pugInput({ clientUrl: null }));
    expect(row?.toJSON().components).toHaveLength(2);
  });

  // ROK-1462 AC1: the <=2 cap must be enforced HERE, not only by the sourcing
  // module. Hand the builder three fields so the assertion fails if the builder
  // forwards whatever it is given (the previous version of this test handed it
  // exactly two and therefore proved nothing).
  it('truncates to the first two personalized fields when handed three', () => {
    const { embed } = buildPugInviteEmbed(
      pugInput({
        personalized: [
          {
            kind: 'owned',
            name: OWNED_FIELD,
            value: '142 hrs played',
          },
          {
            kind: 'wishlist',
            name: WISHLIST_FIELD,
            value: 'Wishlisted',
          },
          {
            kind: 'hearted',
            name: HEARTED_FIELD,
            value: 'Hearted 3 weeks ago',
          },
        ],
      }),
    );
    const names = (embed.toJSON().fields ?? []).map((f) => f.name);
    const personalized = names.filter((n) => PERSONALIZED_FIELD_NAMES.has(n));

    expect(personalized).toEqual([OWNED_FIELD, WISHLIST_FIELD]);
    expect(names).not.toContain(HEARTED_FIELD);
  });

  it('keeps both personalized fields when handed exactly two', () => {
    const { embed } = buildPugInviteEmbed(
      pugInput({
        personalized: [
          { kind: 'owned', name: OWNED_FIELD, value: '142 hrs played' },
          { kind: 'wishlist', name: WISHLIST_FIELD, value: 'Wishlisted' },
        ],
      }),
    );
    const names = (embed.toJSON().fields ?? []).map((f) => f.name);

    expect(names.filter((n) => PERSONALIZED_FIELD_NAMES.has(n))).toEqual([
      OWNED_FIELD,
      WISHLIST_FIELD,
    ]);
  });

  it('sets the game cover as the thumbnail when one is known', () => {
    const { embed } = buildPugInviteEmbed(
      pugInput({ coverUrl: 'https://cdn.example/drg.jpg' }),
    );
    expect(embed.toJSON().thumbnail?.url).toBe('https://cdn.example/drg.jpg');
  });
});

describe('buildMemberInviteEmbed (AC2)', () => {
  function memberInput(overrides: Record<string, unknown> = {}) {
    return {
      eventId: 42,
      notificationId: 'notif-1',
      event: makeEvent(),
      communityName: 'Test Guild',
      clientUrl: 'https://rl.example',
      voiceChannelId: 'voice-9',
      now: NOW,
      ...overrides,
    };
  }

  it('renders on the DM chrome with the INVITED author line', () => {
    const { embed } = buildMemberInviteEmbed(memberInput());
    const data = embed.toJSON();

    expect(data.color).toBe(EMBED_COLORS.REMINDER);
    expect(data.author?.name).toBe('✉ INVITED · starts in 40 min');
    expect(data.title).toBe('Deep Rock Galactic — Friday Deep Dive');
    expect(data.description ?? '').not.toContain('](');
  });

  it('keeps the voice channel field and adds the View Event button', () => {
    const { embed, row } = buildMemberInviteEmbed(memberInput());
    const voice = (embed.toJSON().fields ?? []).find(
      (f) => f.name === 'Voice Channel',
    );

    expect(voice?.value).toBe('<#voice-9>');
    expect(row?.toJSON().components).toHaveLength(3);
  });

  it('carries no personalized field — the reader is not the subject', () => {
    const { embed } = buildMemberInviteEmbed(memberInput());
    const names = (embed.toJSON().fields ?? []).map((f) => f.name);

    expect(names).not.toContain('\u{1F3AE} In your library');
    expect(names).not.toContain('⭐ On your wishlist');
    expect(names).not.toContain('\u{1F49B} You hearted this');
  });
});

describe('buildInviteRelayEmbed (AC2)', () => {
  it('renders on the DM chrome in the announcing state', () => {
    const { embed } = buildInviteRelayEmbed('roknua', 'https://discord.gg/x', {
      communityName: 'Test Guild',
    });
    const data = embed.toJSON();

    expect(data.color).toBe(EMBED_COLORS.ANNOUNCEMENT);
    expect(data.author?.name).toBe('✉ SERVER INVITE NEEDED');
    expect(data.footer?.text).toBe('Test Guild');
    expect(data.description).toContain('https://discord.gg/x');
  });

  it('adds a View Event link button when the event context is known', () => {
    const { row } = buildInviteRelayEmbed('roknua', 'https://discord.gg/x', {
      communityName: 'Test Guild',
      clientUrl: 'https://rl.example',
      eventId: 42,
    });

    expect(row?.toJSON().components).toEqual([
      expect.objectContaining({
        label: 'View Event',
        style: ButtonStyle.Link,
        url: 'https://rl.example/events/42',
      }),
    ]);
  });

  it('omits the row entirely without a client URL', () => {
    const { row } = buildInviteRelayEmbed('roknua', 'https://discord.gg/x', {
      communityName: 'Test Guild',
      eventId: 42,
    });
    expect(row).toBeUndefined();
  });
});
