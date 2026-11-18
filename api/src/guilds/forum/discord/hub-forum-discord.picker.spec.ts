/**
 * ROK-2258 — the tag budget the picker and preflight show: slots left once
 * every bound hub still without a tag gets one (0 = no hub can join). A lone
 * hub tagged at bind time reserves nothing more; the Event tag is
 * best-effort (skipped when the forum is full), so it is never reserved.
 */
import { freeSlots } from './hub-forum-discord.picker';

describe('freeSlots', () => {
  it('an empty forum with no hubs offers all 20', () => {
    expect(freeSlots(0, 0)).toBe(20);
  });

  it('a lone hub already tagged (hub + Event tags) reserves nothing more', () => {
    expect(freeSlots(2, 0)).toBe(18);
  });

  it('a lone untagged hub (decor never ran) reserves its own tag', () => {
    expect(freeSlots(3, 1)).toBe(16);
  });

  it('every untagged hub reserves a slot, not only a lone one', () => {
    expect(freeSlots(5, 2)).toBe(13);
  });

  it('a forum full once the untagged hubs are tagged offers 0', () => {
    expect(freeSlots(19, 1)).toBe(0);
    expect(freeSlots(20, 0)).toBe(0);
    expect(freeSlots(20, 2)).toBe(0);
  });
});
