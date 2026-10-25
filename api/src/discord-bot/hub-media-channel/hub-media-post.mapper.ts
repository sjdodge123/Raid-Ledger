import type { Message } from 'discord.js';
import type { PostLike } from './hub-media-post.images';

/** A gateway (or fetched) message → the plain `PostLike` ingest reads. */
export function toPostLike(message: Message): PostLike {
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
