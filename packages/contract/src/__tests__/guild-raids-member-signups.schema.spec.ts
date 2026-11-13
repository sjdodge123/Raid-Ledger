/**
 * ROK-2185 item 2: optional `memberSignupCount` on an upcoming event card.
 * Additive — a card without it (old server, stored JSON) still parses.
 */
import { describe, it, expect } from 'vitest';
import { GuildEventCardSchema } from '../guild-raids.schema.js';

const card = {
  id: 1,
  title: 'Raid night',
  startTime: '2026-11-13T20:00:00.000Z',
  endTime: '2026-11-13T23:00:00.000Z',
  signupCount: 6,
  needed: 10,
  viewerStatus: null,
};

describe('GuildEventCardSchema.memberSignupCount (ROK-2185)', () => {
  it('parses the old shape without the field', () => {
    const parsed = GuildEventCardSchema.parse(card);
    expect(parsed.memberSignupCount).toBeUndefined();
  });

  it('keeps the member signup count when present', () => {
    const parsed = GuildEventCardSchema.parse({ ...card, memberSignupCount: 4 });
    expect(parsed.memberSignupCount).toBe(4);
  });

  it('rejects a non-integer member signup count', () => {
    const res = GuildEventCardSchema.safeParse({ ...card, memberSignupCount: 1.5 });
    expect(res.success).toBe(false);
  });
});
