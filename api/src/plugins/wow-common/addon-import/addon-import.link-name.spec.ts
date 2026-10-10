/**
 * ROK-1760: the raw item link → fallback name/quality parser, including
 * hostile input (it runs on the untrusted link BEFORE escapes are stripped).
 */
import { LINK_NAME_MAX, parseLinkDisplay } from './addon-import.link-name';

const SHIRT = "|cnIQ1:|Hitem:6120::::::::1:::::::::|h[Recruit's Shirt]|h|r";

describe('parseLinkDisplay (ROK-1760)', () => {
  it('reads the name and IQ quality from a real LedgerLink gear link', () => {
    expect(parseLinkDisplay(SHIRT)).toEqual({
      name: "Recruit's Shirt",
      quality: 1,
    });
  });

  it('maps every IQ0-7 quality and ignores an out-of-range IQ', () => {
    for (let q = 0; q <= 7; q++) {
      expect(parseLinkDisplay(`|cnIQ${q}:|h[X]|h`).quality).toBe(q);
    }
    expect(parseLinkDisplay('|cnIQ9:|h[X]|h')).toEqual({ name: 'X' });
  });

  it('yields no name when the brackets or the closing |h are missing', () => {
    expect(parseLinkDisplay('|cnIQ2:|Hitem:6120|hRecruit|h|r')).toEqual({
      quality: 2,
    });
    expect(parseLinkDisplay('|Hitem:6120|h[Recruit')).toEqual({});
    expect(parseLinkDisplay('|Hitem:6120|h[]|h')).toEqual({});
    expect(parseLinkDisplay('item:6120')).toEqual({});
  });

  it('never lets a nested |h[ leak pipes or brackets into the name', () => {
    expect(parseLinkDisplay('|Hitem:1|h[a|h[b]|h]|h')).toEqual({ name: 'b' });
  });

  it('caps a 600-char name at LINK_NAME_MAX code units', () => {
    const name = parseLinkDisplay(`|h[${'x'.repeat(600)}]|h`).name;
    expect(name).toBe('x'.repeat(LINK_NAME_MAX));
  });

  it('never cuts a surrogate pair in half at the cap', () => {
    const long = `${'a'.repeat(LINK_NAME_MAX - 1)}\u{1F600}tail`;
    expect(parseLinkDisplay(`|h[${long}]|h`).name).toBe(
      'a'.repeat(LINK_NAME_MAX - 1),
    );
  });

  it('strips control characters and drops a name that is only control chars', () => {
    expect(parseLinkDisplay('|h[Bad\u0000Na\u001bme\u0085]|h')).toEqual({
      name: 'BadName',
    });
    expect(parseLinkDisplay('|h[\u0001\u0002 ]|h')).toEqual({});
  });
});
