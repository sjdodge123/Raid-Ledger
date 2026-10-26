import type { PostLike } from './hub-media-post.images';

/**
 * The slice of a discord.js `Message` the listener reads — structural, so a
 * real `Message` fits and a spec needs no fixture.
 */
export interface GatewayPost {
  id: string;
  channelId: string;
  guildId: string | null;
  createdAt: Date;
  content: string;
  author: { id: string };
  attachments: {
    values(): Iterable<{
      id: string;
      url: string;
      contentType: string | null;
      name: string;
    }>;
  };
  embeds: readonly {
    description: string | null;
    title: string | null;
    image: { url: string } | null;
  }[];
}

/** A gateway (or fetched) message → the plain `PostLike` ingest reads. */
export function toPostLike(message: GatewayPost): PostLike {
  return {
    id: message.id,
    channelId: message.channelId,
    createdAt: message.createdAt,
    authorId: message.author.id,
    content: message.content,
    attachments: [...message.attachments.values()].map((a) => ({
      id: a.id,
      url: a.url,
      contentType: a.contentType,
      name: a.name,
    })),
    embeds: message.embeds.map((e) => ({
      description: e.description,
      title: e.title,
      imageUrl: e.image?.url ?? null,
    })),
  };
}
