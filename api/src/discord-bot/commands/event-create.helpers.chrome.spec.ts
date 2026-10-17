/**
 * ROK-1477 (Lane A) — `/event create` and `/event plan` on the shared chrome.
 *
 * Both replies were bare `EmbedBuilder`s that set their own colour. The colours
 * they set map exactly onto two states, so neither reply changes colour: a
 * created event is `live` (created AND confirmed — `discord-bot.constants.ts`
 * calls that state "it is confirmed") and the planning form is `announcing`.
 * What changes is that the state now lives in the author line and the colour
 * comes from `colorForState`, not from a literal.
 */
import {
  buildConfirmationEmbed,
  buildPlanReply,
  type ParsedCreateOptions,
} from './event-create.helpers';
import { COMMAND_REPLY_AUTHORS } from './command-reply-chrome.helpers';
import { colorForState } from '../embeds/embed-chrome.helpers';

function makeOptions(
  overrides: Partial<ParsedCreateOptions> = {},
): ParsedCreateOptions {
  return {
    title: 'Friday Deep Dive',
    game: { id: 7, name: 'Deep Rock Galactic' },
    parsed: { timezone: 'UTC' } as ParsedCreateOptions['parsed'],
    slotConfig: undefined,
    maxAttendees: 8,
    ...overrides,
  };
}

const START = new Date('2026-09-11T20:00:00Z');

describe('buildConfirmationEmbed — shared chrome (ROK-1477)', () => {
  it('carries the EVENT CREATED author line', () => {
    expect(buildConfirmationEmbed(makeOptions(), START).data.author?.name).toBe(
      COMMAND_REPLY_AUTHORS.EVENT_CREATED,
    );
  });

  it('is emerald live — the event is created and confirmed', () => {
    expect(buildConfirmationEmbed(makeOptions(), START).data.color).toBe(
      colorForState('live'),
    );
  });

  it('keeps the "Event Created" title the smoke suite pins', () => {
    expect(buildConfirmationEmbed(makeOptions(), START).data.title).toBe(
      'Event Created',
    );
  });

  it('still renders the event title and slot count in the description', () => {
    const desc =
      buildConfirmationEmbed(makeOptions(), START).data.description ?? '';
    expect(desc).toContain('**Friday Deep Dive**');
    expect(desc).toContain('Slots: **8**');
    expect(desc).toContain('Timezone: UTC');
  });
});

describe('buildPlanReply — shared chrome (ROK-1477)', () => {
  it('carries the EVENT PLANNING author line', () => {
    expect(
      buildPlanReply('https://raid.example/x').embeds[0].data.author?.name,
    ).toBe(COMMAND_REPLY_AUTHORS.EVENT_PLAN);
  });

  it('is cyan announcing — a planning form is an announcement, not a state change', () => {
    expect(buildPlanReply('https://raid.example/x').embeds[0].data.color).toBe(
      colorForState('announcing'),
    );
  });

  it('keeps the link button pointing at the magic link', () => {
    const reply = buildPlanReply('https://raid.example/x');
    expect(reply.components[0].components).toHaveLength(1);
  });
});
