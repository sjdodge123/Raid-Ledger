import { parseAllowedSourceUrl } from '../../hub-media/hub-media-download';
import type { HubMediaPostText } from '../../hub-media/hub-media-classifier.registry';

/** A Discord attachment, reduced to what ingest reads. */
export interface PostAttachment {
  id: string;
  url: string;
  contentType: string | null;
  name: string;
}

/** A Discord embed, reduced to what ingest reads. */
export interface PostEmbed {
  description: string | null;
  title: string | null;
  imageUrl: string | null;
}

/**
 * ROK-1941 — a source post as plain data, so ingest (live + L3 backfill) and
 * its specs never need a discord.js `Message`.
 */
export interface PostLike extends HubMediaPostText {
  channelId: string;
  authorId: string | null;
  attachments: readonly PostAttachment[];
  embeds: readonly PostEmbed[];
}

/** One picture of a post, keyed for `discordProvenanceKey` (D6). */
export interface PostImage {
  attachmentId: string;
  url: string;
  filename: string | null;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;

function isImageAttachment(a: PostAttachment): boolean {
  if (a.contentType) return a.contentType.startsWith('image/');
  return IMAGE_EXT_RE.test(a.name);
}

/** D6: image attachments, then embed images on an allowed host (`e<index>`). */
export function postImages(post: PostLike): PostImage[] {
  const attached = post.attachments
    .filter(isImageAttachment)
    .map((a) => ({ attachmentId: a.id, url: a.url, filename: a.name }));
  const embedded = post.embeds.flatMap((e, i) =>
    e.imageUrl && parseAllowedSourceUrl(e.imageUrl)
      ? [{ attachmentId: `e${i}`, url: e.imageUrl, filename: null }]
      : [],
  );
  return [...attached, ...embedded];
}
