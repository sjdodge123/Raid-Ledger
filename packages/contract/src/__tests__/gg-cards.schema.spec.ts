import { describe, expect, it } from 'vitest';
import {
  GgEventsCardSchema,
  GgHubsCardSchema,
  GgOnTimeCardSchema,
} from '../gg-cards.schema.js';

const events = {
  signedUp: 3, attended: 2, noShows: 0,
  firstEventAt: null, lastEventAt: null,
};

describe('GG card year visuals (ROK-2187 L3c, additive optional)', () => {
  it('events: eventsByMonth is optional and exactly 12 non-negative counts', () => {
    expect(GgEventsCardSchema.safeParse(events).success).toBe(true);
    const months = [0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 4];
    expect(GgEventsCardSchema.safeParse({ ...events, eventsByMonth: months }).success).toBe(true);
    expect(GgEventsCardSchema.safeParse({ ...events, eventsByMonth: months.slice(1) }).success).toBe(false);
    expect(GgEventsCardSchema.safeParse({ ...events, eventsByMonth: [...months.slice(1), -1] }).success).toBe(false);
  });

  it('on-time: weeksAttended is optional, booleans, at most 53 weeks', () => {
    const base = { attended: 2, onTime: 1, onTimeRatio: 0.5 };
    expect(GgOnTimeCardSchema.safeParse(base).success).toBe(true);
    const weeks = Array.from({ length: 52 }, (_, i) => i % 2 === 0);
    expect(GgOnTimeCardSchema.safeParse({ ...base, weeksAttended: weeks }).success).toBe(true);
    expect(GgOnTimeCardSchema.safeParse({ ...base, weeksAttended: [...weeks, true, true] }).success).toBe(false);
  });

  it('hubs: backdropUrls is optional, https only, at most 4', () => {
    const base = { joined: 1, posts: 2, pictures: 0 };
    const url = 'https://images.igdb.com/igdb/image/upload/t_screenshot_med/a.jpg';
    expect(GgHubsCardSchema.safeParse(base).success).toBe(true);
    expect(GgHubsCardSchema.safeParse({ ...base, backdropUrls: [url] }).success).toBe(true);
    expect(GgHubsCardSchema.safeParse({ ...base, backdropUrls: ['http://x.test/a.jpg'] }).success).toBe(false);
    expect(GgHubsCardSchema.safeParse({ ...base, backdropUrls: Array(5).fill(url) }).success).toBe(false);
  });
});
