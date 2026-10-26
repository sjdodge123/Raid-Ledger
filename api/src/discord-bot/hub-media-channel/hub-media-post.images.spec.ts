/** ROK-1941 D6 — which pictures of a post are ingested, in order. */
import { postImages, type PostLike } from './hub-media-post.images';

const CDN = 'https://cdn.discordapp.com/attachments/1/2';
const base: PostLike = {
  id: '2',
  channelId: '1',
  authorId: null,
  createdAt: new Date('2026-10-20T12:00:00Z'),
  content: '',
  attachments: [],
  embeds: [],
};
const att = (id: string, name: string, contentType: string | null) => ({
  id,
  url: `${CDN}/${name}`,
  contentType,
  name,
});

describe('postImages (D6)', () => {
  it('keeps image/* attachments and drops other content types', () => {
    const got = postImages({
      ...base,
      attachments: [
        att('a', 'shot.png', 'image/png'),
        att('b', 'log.txt', 'text/plain'),
        att('c', 'clip.png', 'video/mp4'),
      ],
    });
    expect(got.map((i) => i.attachmentId)).toEqual(['a']);
  });

  it('falls back to the extension when the content type is missing', () => {
    const got = postImages({
      ...base,
      attachments: [
        att('a', 'Bjorn.JPEG', null),
        att('b', 'x.webp', null),
        att('c', 'notes.pdf', null),
      ],
    });
    expect(got.map((i) => [i.attachmentId, i.filename])).toEqual([
      ['a', 'Bjorn.JPEG'],
      ['b', 'x.webp'],
    ]);
  });

  it('adds embed images on an allowed host after attachments, keyed e<index>', () => {
    const got = postImages({
      ...base,
      attachments: [att('a', 'shot.png', 'image/png')],
      embeds: [
        { description: null, title: null, imageUrl: null },
        {
          description: null,
          title: null,
          imageUrl: 'https://evil.example/x.png',
        },
        { description: null, title: null, imageUrl: `${CDN}/embed.png` },
      ],
    });
    expect(got.map((i) => [i.attachmentId, i.filename])).toEqual([
      ['a', 'shot.png'],
      ['e2', null],
    ]);
  });
});
