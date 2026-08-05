/**
 * ROK-1422 — the "Play again?" event-path follow-up DM must carry the follow-up
 * event's start time as native Discord `<t:>` markup (embed renders viewer-local;
 * plaintext push resolves it in the recipient tz via stripDiscordMarkup). These
 * unit tests pin the message builder — the fast proof for the rendering fix; the
 * companion-bot smoke test covers end-to-end delivery through the in-app mirror.
 */
import { buildInputs } from './post-event-followup-fanout.helpers';

describe('buildInputs (post-event follow-up DM copy)', () => {
  const RECIPIENTS = [11, 22];
  // Fixed epoch (2026-08-15T18:30:00Z) so the token is deterministic.
  const START_EPOCH = 1_786_559_400;

  describe('event path ({ eventId })', () => {
    it('ROK-1422: appends the follow-up event start as <t:EPOCH:F> (+ :R)', () => {
      const [input] = buildInputs(
        RECIPIENTS,
        "Baldur's Gate 3",
        { eventId: 42 },
        START_EPOCH,
      );
      expect(input.message).toContain(`<t:${START_EPOCH}:F>`);
      expect(input.message).toContain(`<t:${START_EPOCH}:R>`);
      // The ended-event title copy is preserved, not replaced.
      expect(input.message).toContain("follow-up to **Baldur's Gate 3**");
    });

    it('builds one input per recipient with the quick-signup title + payload', () => {
      const inputs = buildInputs(
        RECIPIENTS,
        'Deadlock',
        { eventId: 42 },
        START_EPOCH,
      );
      expect(inputs).toHaveLength(RECIPIENTS.length);
      for (const input of inputs) {
        expect(input.type).toBe('post_event_followup');
        expect(input.title).toBe('Play again?');
        expect(input.payload).toEqual({ eventId: 42 });
      }
      expect(inputs.map((i) => i.userId)).toEqual(RECIPIENTS);
    });

    it('omits the timestamp (no throw) when the start epoch is unknown', () => {
      const [input] = buildInputs(
        RECIPIENTS,
        'Deadlock',
        { eventId: 42 },
        null,
      );
      expect(input.message).not.toContain('<t:');
      expect(input.message).toBe('Sign up for the follow-up to **Deadlock**.');
    });
  });

  describe('poll path ({ lineupId, matchId })', () => {
    it('never carries a timestamp (no fixed time yet)', () => {
      const [input] = buildInputs(
        RECIPIENTS,
        'Deadlock',
        { lineupId: 1, matchId: 2, subtype: 'post_event_poll' },
        // A stray epoch must still be ignored on the poll path.
        START_EPOCH,
      );
      expect(input.message).not.toContain('<t:');
      expect(input.title).toBe('Vote on a follow-up time');
      expect(input.message).toContain('Help pick a time for the next');
    });
  });
});
