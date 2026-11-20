import { CLOSING_LINE_COPY as COPY } from './hub-forum-discord-closing-lines.copy';
import {
  CLOSING_FIELD_MAX,
  closingLineText,
  neutralise,
} from './hub-forum-discord-closing-lines';
import { DISCORD_MESSAGE_MAX } from './hub-forum-discord-content';

const URL = 'https://rl.example/';

describe('closingLineText (ROK-2272 S8)', () => {
  it('poll locked in: calendar, event title and the event link', () => {
    const text = closingLineText(
      { kind: 'poll-locked-in', eventId: 42, eventTitle: 'Raid Night' },
      URL,
    );
    expect(text).toBe(
      '\u{1F4C5} Raid Night is happening! \u{2192} https://rl.example/events/42',
    );
  });

  it('poll cancelled: plain without a reason, with the reason when given', () => {
    const plain = { kind: 'poll-cancelled', reason: null } as const;
    expect(closingLineText(plain, URL)).toBe(COPY.pollCancelled);
    const blank = { kind: 'poll-cancelled', reason: '   ' } as const;
    expect(closingLineText(blank, URL)).toBe('Poll cancelled');
    const why = { kind: 'poll-cancelled', reason: 'Nobody free' } as const;
    expect(closingLineText(why, URL)).toBe('Poll cancelled — Nobody free');
  });

  it('lineup decided: one game, several games joined, none resolvable', () => {
    const one = { kind: 'lineup-decided', lineupId: 7, games: ['Valheim'] };
    expect(closingLineText({ ...one, kind: 'lineup-decided' }, URL)).toBe(
      '\u{1F3C6} Decided: Valheim \u{2192} https://rl.example/community-lineup/7',
    );
    const two = closingLineText(
      { kind: 'lineup-decided', lineupId: 7, games: ['Valheim', 'BG3'] },
      URL,
    );
    expect(two).toContain('Decided: Valheim · BG3 ');
    const none = closingLineText(
      { kind: 'lineup-decided', lineupId: 7, games: [] },
      URL,
    );
    expect(none).toBe(
      '\u{1F3C6} Decided \u{2192} https://rl.example/community-lineup/7',
    );
  });

  it('lineup aborted', () => {
    expect(closingLineText({ kind: 'lineup-aborted' }, URL)).toBe(
      'Lineup aborted',
    );
  });

  it('escapes markdown and breaks mentions in user text', () => {
    const text = closingLineText(
      { kind: 'poll-cancelled', reason: '@everyone **now** <@123>' },
      URL,
    );
    expect(text).not.toContain('@everyone');
    expect(text).not.toContain('<@123>');
    expect(text).toContain('\\*\\*now\\*\\*');
    expect(neutralise('@here')).toBe('@​here');
  });

  it('caps each field and the whole line at the Discord limit', () => {
    const huge = 'x'.repeat(5000);
    const text = closingLineText(
      { kind: 'poll-locked-in', eventId: 1, eventTitle: huge },
      URL,
    );
    expect(text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX);
    expect(text).toContain('/events/1');
    expect(neutralise(huge)).toHaveLength(CLOSING_FIELD_MAX);
    const games = Array.from({ length: 50 }, () => '_'.repeat(200));
    const many = closingLineText(
      { kind: 'lineup-decided', lineupId: 1, games },
      URL,
    );
    expect(many.length).toBeLessThanOrEqual(DISCORD_MESSAGE_MAX);
  });
});
