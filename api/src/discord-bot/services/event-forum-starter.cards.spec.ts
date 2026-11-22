/**
 * ROK-2292 Codex P2 — a forum starter card built while a reschedule poll is
 * open is RESCHEDULING, like the announcement; `computeEmbedState` never is.
 */
import { EMBED_STATES } from '../discord-bot.constants';
import { starterState } from './event-forum-starter.cards';

describe('starterState', () => {
  it('holds the card at RESCHEDULING while a reschedule poll is open', () => {
    expect(starterState({ reschedulingPollId: 7 }, EMBED_STATES.POSTED)).toBe(
      EMBED_STATES.RESCHEDULING,
    );
  });

  it('keeps the computed state when no poll is open', () => {
    expect(
      starterState({ reschedulingPollId: null }, EMBED_STATES.FILLING),
    ).toBe(EMBED_STATES.FILLING);
  });
});
