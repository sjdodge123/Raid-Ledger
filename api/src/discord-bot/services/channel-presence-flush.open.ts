/**
 * ROK-1446 D7 — the flush's first-occupancy post.
 *
 * Split out of `channel-presence-flush.ts` only to keep that file under the
 * 300-line cap (ROK-1692 added the brief-visit branch); moved verbatim, and it
 * has no meaning apart from the live ladder there.
 */
import { sendEmbeds } from '../discord-bot-client.messages.helpers';
import type { ChannelEmbed } from '../embeds/embed-chrome.helpers';
import { resolveNotificationChannel } from './ad-hoc-notification.helpers';
import type { ChannelFlush } from './channel-presence-flush';
import { payloadHashOf } from './channel-presence-flush.helpers';
import { openRow, savePayloadHash } from './channel-presence-store.helpers';

/**
 * First occupancy: post the message, then record it (D7 — the DB is truth).
 *
 * `openRow` is a partial-index-safe upsert, so a lost race returns the row
 * that won rather than throwing. The hash is stored only for the row we
 * actually posted; on a lost race the winner's message is the live one and its
 * own flush owns the hash.
 */
export async function openMessage(
  flush: ChannelFlush,
  embeds: ChannelEmbed[],
  openedAt: Date,
): Promise<string | null> {
  const binding = flush.binding;
  if (!binding) return null;
  const textChannelId = await resolveNotificationChannel(
    flush.deps,
    binding.bindingId,
    null,
  );
  if (!textChannelId) {
    flush.logger.warn(
      `No text channel resolved for lobby presence in ${flush.channelId}`,
    );
    return null;
  }
  const client = flush.deps.clientService.getClient();
  const message = await sendEmbeds(client, textChannelId, embeds);
  return recordOpenedMessage(
    flush,
    binding.bindingId,
    { textChannelId, messageId: message.id, embeds },
    openedAt,
  );
}

/**
 * Write the ledger row for a message we just posted, or disown it on a race.
 *
 * @returns The id of the row WE own, or `null` when another writer won it —
 *   the winner's flush owns its occupancy as well as its hash.
 */
async function recordOpenedMessage(
  flush: ChannelFlush,
  bindingId: string,
  posted: { textChannelId: string; messageId: string; embeds: ChannelEmbed[] },
  openedAt: Date,
): Promise<string | null> {
  const result = await openRow(flush.deps.db, {
    guildId: flush.guildId,
    voiceChannelId: flush.channelId,
    bindingId,
    textChannelId: posted.textChannelId,
    messageId: posted.messageId,
    openedAt,
  });
  if (!result.created) {
    flush.logger.warn(
      `Presence row for ${flush.channelId} was opened concurrently; message ${posted.messageId} is orphaned`,
    );
    return null;
  }
  await savePayloadHash(
    flush.deps.db,
    result.row.id,
    payloadHashOf(posted.embeds),
  );
  return result.row.id;
}
