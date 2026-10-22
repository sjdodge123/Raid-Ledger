/**
 * ROK-1872 (ROK-1428 §2.11 H7): the decided game's hub link on the lineup
 * decided / event-created embeds. No hub ⇒ the description is unchanged.
 */
import {
  buildDecidedEmbed,
  buildEventCreatedEmbed,
  type EmbedContext,
  type MatchSummary,
} from './lineup-notification-embed.helpers';
import type { HubLink } from '../discord-bot/embeds/hub-link-button.helpers';

const BASE_URL = 'https://raid.example';
const HUB: HubLink = { url: `${BASE_URL}/hubs?game=1`, label: 'Hubs' };
const ctx: EmbedContext = {
  baseUrl: BASE_URL,
  lineupId: 1,
  communityName: 'Guild',
  phase: 'decided',
};
const MATCHES: MatchSummary[] = [
  {
    id: 1,
    gameId: 1,
    gameName: 'Deep Rock',
    thresholdMet: true,
    voteCount: 9,
    status: 'scheduling',
  },
];

function decided(c: EmbedContext): string {
  return buildDecidedEmbed(c, MATCHES).embed.toJSON().description ?? '';
}

function created(c: EmbedContext, eventId?: number): string {
  const date = new Date('2026-09-18T19:00:00.000Z');
  const { embed } = buildEventCreatedEmbed(c, 'Deep Rock', 1, date, eventId);
  return embed.toJSON().description ?? '';
}

describe('lineup embeds hub link (H7)', () => {
  it('H7: decided embed appends the hub link to the results line', () => {
    expect(decided({ ...ctx, hubLink: HUB })).toMatch(
      /\[View results ↗\]\([^)]+\) · \[Hubs ↗\]\(https:\/\/raid\.example\/hubs\?game=1\)$/,
    );
  });

  it('H7: event-created embed appends it after the lineup link', () => {
    for (const eventId of [55, undefined]) {
      expect(created({ ...ctx, hubLink: HUB }, eventId)).toMatch(
        /\[Open lineup ↗\]\([^)]+\) · \[Hubs ↗\]\([^)]+\)$/,
      );
    }
  });

  it('H7: without a hub both embeds are unchanged', () => {
    expect(decided({ ...ctx, hubLink: null })).toBe(decided(ctx));
    expect(created({ ...ctx, hubLink: null }, 55)).toBe(created(ctx, 55));
    expect(decided(ctx)).not.toContain('Hub');
  });
});
