/**
 * ROK-1941 L1 (D5/D15): the Valheim screenshot mod's post wording and the
 * capture filename's mm:ss tie-breaker.
 */
import {
  captureSecondOfHour,
  classifyPost,
  postText,
} from './valheim-screenshot.parse';

describe('classifyPost', () => {
  it('reads a death post with a plain name', () => {
    expect(classifyPost('Bjorn met their demise!')).toEqual({
      kind: 'death',
      name: 'Bjorn',
    });
  });

  it('strips markdown bold around the name', () => {
    expect(classifyPost('**Ragnar the Red** met their demise!')).toEqual({
      kind: 'death',
      name: 'Ragnar the Red',
    });
  });

  it('reads a screenshot post and allows trailing text after whitespace', () => {
    expect(
      classifyPost('**Astrid** captured this screenshot! Look at this'),
    ).toEqual({ kind: 'screenshot', name: 'Astrid' });
  });

  it('trims surrounding whitespace before matching', () => {
    expect(classifyPost('  Bjorn met their demise!\n')).toEqual({
      kind: 'death',
      name: 'Bjorn',
    });
  });

  it.each([
    ['unrelated text', 'look at my base'],
    ['text glued to the bang', 'Bjorn met their demise!!'],
    ['a name over 64 characters', `${'a'.repeat(65)} met their demise!`],
    ['a blank bold name', '**   ** met their demise!'],
    ['empty text', ''],
  ])('classifies %s as a plain image', (_label, text) => {
    expect(classifyPost(text)).toEqual({ kind: 'image', name: null });
  });

  it('refuses a name containing a newline', () => {
    expect(classifyPost('Bj\norn met their demise!')).toEqual({
      kind: 'image',
      name: null,
    });
  });
});

describe('postText', () => {
  it('prefers the message content', () => {
    expect(postText(' Bjorn met their demise! ', [{ title: 'x' }])).toBe(
      'Bjorn met their demise!',
    );
  });

  it('falls back to the first embed description, then its title', () => {
    expect(postText('', [{ description: 'desc', title: 't' }])).toBe('desc');
    expect(postText('  ', [{ description: null, title: 'title' }])).toBe(
      'title',
    );
  });

  it('returns empty text when there is no content and no embed', () => {
    expect(postText('', [])).toBe('');
  });
});

describe('captureSecondOfHour', () => {
  it('returns mm*60+ss from a capture filename', () => {
    expect(captureSecondOfHour('Valheim_2026-10-20_14-05-33.png')).toBe(333);
  });

  it('accepts jpg/jpeg/webp in any case', () => {
    expect(captureSecondOfHour('shot_2026-10-20_01-00-07.JPEG')).toBe(7);
    expect(captureSecondOfHour('shot_2026-10-20_01-59-59.webp')).toBe(3599);
  });

  it.each([
    'screenshot.png',
    'shot_2026-10-20_14-05-33.gif',
    'shot_2026-10-20_14-61-00.png',
    'shot_2026-10-20_14-05-60.png',
  ])('returns null for %s', (name) => {
    expect(captureSecondOfHour(name)).toBeNull();
  });
});
