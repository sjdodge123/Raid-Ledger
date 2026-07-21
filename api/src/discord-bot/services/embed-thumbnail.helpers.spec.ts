import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';

describe('absoluteEmbedImageUrl (ROK-1410)', () => {
  const prevClientUrl = process.env.CLIENT_URL;
  afterEach(() => {
    if (prevClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = prevClientUrl;
  });

  it('passes absolute http(s) URLs through unchanged', () => {
    expect(absoluteEmbedImageUrl('https://images.igdb.com/x.jpg')).toBe(
      'https://images.igdb.com/x.jpg',
    );
    expect(absoluteEmbedImageUrl('http://a.example/b.png')).toBe(
      'http://a.example/b.png',
    );
  });

  it('resolves root-relative covers against CLIENT_URL', () => {
    process.env.CLIENT_URL = 'https://raid.gamernight.net';
    expect(absoluteEmbedImageUrl('/game-covers/chao-chao-cover.jpg')).toBe(
      'https://raid.gamernight.net/game-covers/chao-chao-cover.jpg',
    );
  });

  it('strips trailing slashes from CLIENT_URL before joining', () => {
    process.env.CLIENT_URL = 'https://raid.gamernight.net/';
    expect(absoluteEmbedImageUrl('/game-covers/x.jpg')).toBe(
      'https://raid.gamernight.net/game-covers/x.jpg',
    );
  });

  it('returns null for relative covers when CLIENT_URL is unset (omit, never post a bad embed URL)', () => {
    delete process.env.CLIENT_URL;
    expect(absoluteEmbedImageUrl('/game-covers/x.jpg')).toBeNull();
  });

  it('returns null for null/empty/non-rooted values', () => {
    process.env.CLIENT_URL = 'https://raid.gamernight.net';
    expect(absoluteEmbedImageUrl(null)).toBeNull();
    expect(absoluteEmbedImageUrl(undefined)).toBeNull();
    expect(absoluteEmbedImageUrl('')).toBeNull();
    expect(absoluteEmbedImageUrl('game-covers/x.jpg')).toBeNull();
  });
});
