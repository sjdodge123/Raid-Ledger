import { raceDisplayName } from './addon-import.race';

describe('raceDisplayName (ROK-1742)', () => {
  it.each([
    ['Human', 'Human'],
    ['Dwarf', 'Dwarf'],
    ['NightElf', 'Night Elf'],
    ['Gnome', 'Gnome'],
    ['Draenei', 'Draenei'],
    ['Orc', 'Orc'],
    ['Scourge', 'Undead'],
    ['Tauren', 'Tauren'],
    ['Troll', 'Troll'],
    ['BloodElf', 'Blood Elf'],
  ])('maps the %s token to "%s"', (token, display) => {
    expect(raceDisplayName(token)).toBe(display);
  });

  it('passes an unknown token through unchanged', () => {
    expect(raceDisplayName('Pandaren')).toBe('Pandaren');
  });

  it.each(['Night Elf', 'Undead', 'Blood Elf', 'Human'])(
    'is idempotent on the display name "%s"',
    (display) => {
      expect(raceDisplayName(display)).toBe(display);
      expect(raceDisplayName(raceDisplayName(display))).toBe(display);
    },
  );
});
