import {
  buildCharacterBackId,
  parseCharacterBackId,
} from './character-back-id';

describe('character Back customId (ROK-2228)', () => {
  it.each([
    [
      { charSelectPrefix: 'char_select', eventId: 42 },
      'char_back:char_select:42',
    ],
    [
      { charSelectPrefix: 'char_select', eventId: 42, suffix: 'tentative' },
      'char_back:char_select:42:tentative',
    ],
    [
      {
        charSelectPrefix: 'reschedule_char_select',
        eventId: 7,
        suffix: 'tentative',
      },
      'char_back:reschedule_char_select:7:tentative',
    ],
  ])('round-trips %o as %s', (target, id) => {
    expect(buildCharacterBackId(target)).toBe(id);
    expect(parseCharacterBackId(id)).toEqual(target);
    expect(id.length).toBeLessThanOrEqual(100);
  });

  it.each([
    'char_select:42',
    'signup:42',
    'char_back:char_select',
    'char_back:char_select:abc',
    'char_back::42',
    'char_back:char_select:42:tentative:extra',
  ])('rejects %s', (id) => {
    expect(parseCharacterBackId(id)).toBeNull();
  });
});
