/**
 * ROK-1435 — weekly community digest, posted to a channel.
 *
 * The digest runs on an hourly cron gated by a day/hour setting, so the
 * smoke test fires it through the DEMO_MODE fixture
 * `POST /admin/test/trigger-weekly-digest`, which skips the enabled toggle and
 * the slot gate but keeps the real pipeline: channel resolution (dedicated
 * setting → bot default channel), the empty-week skip, the ISO-week dedup
 * claim and the send.
 *
 *  1. Raise an LFG hand so the week is guaranteed non-empty.
 *  2. Trigger with `resetWeek: true` (gives back this week's dedup claim).
 *  3. Assert the embed lands in the default channel (no digest channel is
 *     configured, so this is the fallback) with the digest chrome, the LFG
 *     section, no message content and no mention markup.
 *  4. Trigger again without the reset: the fixture reports `duplicate` and no
 *     second digest appears.
 */
import { readLastMessages, type SimpleMessage } from '../../helpers/messages.js';
import { pollForEmbed } from '../../helpers/polling.js';
import {
  assertConditionNeverMet,
  awaitProcessing,
  postLfgIntent,
  withdrawLfgIntent,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

const LFG_FIELD = '\u{1F50E} Looking for group';
const TITLE_RE = /^Week in review — /;

interface DigestOutcome {
  status: string;
  channelId?: string;
  dedupKey?: string;
  messageId?: string;
}

function triggerDigest(
  api: ApiClient,
  resetWeek: boolean,
): Promise<DigestOutcome> {
  return api.post<DigestOutcome>('/admin/test/trigger-weekly-digest', {
    resetWeek,
  });
}

function isDigest(msg: SimpleMessage): boolean {
  return msg.embeds.some((e) => TITLE_RE.test(e.title ?? ''));
}

function embedText(msg: SimpleMessage): string {
  return msg.embeds
    .flatMap((e) => [
      e.title,
      e.description,
      e.author,
      e.footer,
      ...e.fields.flatMap((f) => [f.name, f.value]),
    ])
    .join('\n');
}

function assertDigestShape(msg: SimpleMessage, gameName: string): void {
  const embed = msg.embeds[0];
  if (!embed?.footer?.includes('Weekly digest')) {
    throw new Error(`Digest footer missing "Weekly digest": ${embed?.footer}`);
  }
  const lfg = embed.fields.find((f) => f.name === LFG_FIELD);
  if (!lfg || !lfg.value.replace(/\\/g, '').includes(gameName)) {
    throw new Error(
      `Digest LFG field missing "${gameName}": ${JSON.stringify(embed.fields)}`,
    );
  }
  if (msg.content !== '') {
    throw new Error(`Digest must carry no message content, got "${msg.content}"`);
  }
  if (/<@[!&]?\d/.test(embedText(msg)) || embedText(msg).includes('@everyone')) {
    throw new Error('Digest embed contains mention markup');
  }
}

async function assertPostedOnce(ctx: TestContext, gameName: string) {
  const first = await triggerDigest(ctx.api, true);
  if (first.status !== 'posted' || !first.messageId) {
    throw new Error(`Expected digest status "posted", got ${JSON.stringify(first)}`);
  }
  if (first.channelId !== ctx.defaultChannelId) {
    throw new Error(
      `Digest went to ${first.channelId}, expected default-channel fallback ${ctx.defaultChannelId}`,
    );
  }
  const msg = await pollForEmbed(
    ctx.defaultChannelId,
    (m) => m.id === first.messageId,
    20_000,
  );
  if (!isDigest(msg)) {
    throw new Error(`Posted message is not a digest: ${msg.embeds[0]?.title}`);
  }
  assertDigestShape(msg, gameName);
  return msg;
}

const digestPostsOncePerWeek: SmokeTest = {
  name: 'Weekly digest posts to the default channel once per week (ROK-1435)',
  category: 'embed',
  async run(ctx: TestContext) {
    const game = ctx.games[0];
    if (!game) {
      console.log('    SKIP: No game available for the weekly digest test');
      return;
    }
    await postLfgIntent(ctx.api, game.id);
    try {
      await awaitProcessing(ctx.api);
      const posted = await assertPostedOnce(ctx, game.name);

      const again = await triggerDigest(ctx.api, false);
      if (again.status !== 'duplicate') {
        throw new Error(`Second trigger in one week: expected "duplicate", got ${JSON.stringify(again)}`);
      }
      await assertConditionNeverMet(
        async () => {
          const msgs = await readLastMessages(ctx.defaultChannelId, 25);
          return msgs.some(
            (m) => isDigest(m) && m.id !== posted.id && m.timestamp >= posted.timestamp,
          );
        },
        6_000,
        'A second weekly digest was posted in the same ISO week',
        { intervalMs: 2000 },
      );
    } finally {
      await withdrawLfgIntent(ctx.api, game.id);
    }
  },
};

export const weeklyDigestTests: SmokeTest[] = [digestPostsOncePerWeek];
