/**
 * ROK-2208 §5.7 item 3 (R11), widened by ROK-2272 S8 (R7) — the inbound
 * write gate for SUBJECT threads (event, scheduling poll, lineup). A Discord
 * message in a post linked to such a thread is imported only when its author
 * may write there (`hub-forum-discord-subject-gate.facts.ts`): an event
 * signup (RL account or OQ-10's anonymous Discord signup), a poll vote or
 * match membership, a lineup nomination or vote. Anyone else stays on
 * Discord only and gets ONE DM per (user, post): Redis `SET NX` on
 * `hfd:notice:<threadId>:<discordId>` for 30 days. Closed DMs (50007) are
 * silent. A read-only thread drops the message without a DM — the lock
 * sweep closes the post. A Discord user can never START a subject thread:
 * inbound top-level posts are always imported as plain threads. The class
 * keeps its event-era name so its DI slot and the ingest stay untouched.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { createDmEmbed } from '../../../discord-bot/embeds/embed-chrome.helpers';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../../redis/redis.module';
import { getClientUrl } from '../../../settings/settings-bot.helpers';
import { SettingsService } from '../../../settings/settings.service';
import type { ForumLink } from './hub-forum-discord-links.queries';
import { subjectNoticeText } from './hub-forum-discord-subject-gate.copy';
import {
  loadSubjectGateFacts,
  type GateSubject,
  type SubjectGateFacts,
} from './hub-forum-discord-subject-gate.facts';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

export type { SubjectGateFacts } from './hub-forum-discord-subject-gate.facts';

/** One notice per (Discord user, post) for 30 days. */
export const EVENT_NOTICE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The Redis "already told" key (thread-keyed, any subject). */
export function eventNoticeKey(threadId: number, discordId: string): string {
  return `hfd:notice:${threadId}:${discordId}`;
}

/** import = sync it; refuse = keep on Discord + DM; drop = keep, no DM. */
export type SubjectGateVerdict = 'import' | 'refuse' | 'drop';

/** §5.7 decision on plain facts (pure). */
export function subjectGateVerdict(
  f: SubjectGateFacts,
  now: Date,
): SubjectGateVerdict {
  if (f.subject === null) return 'import';
  const closes = f.writeClosesAt;
  const ended = closes !== null && closes.getTime() <= now.getTime();
  if (f.eventDetachedAt !== null || ended) return 'drop';
  return f.participant ? 'import' : 'refuse';
}

/** Discord's "Cannot send messages to this user" (DMs closed). */
function isClosedDms(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err
    ? err.code === 50007
    : false;
}

/** The R11 write gate. */
@Injectable()
export class HubForumDiscordEventGate {
  private readonly logger = new Logger(HubForumDiscordEventGate.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: ForumDiscordDb,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly client: DiscordBotClientService,
    private readonly settings: SettingsService,
  ) {}

  /** True when the message may be imported into the post's RL thread. */
  async admits(
    post: Pick<ForumLink, 'threadId'>,
    authorId: string,
    now = new Date(),
  ): Promise<boolean> {
    const facts = await this.loadFacts(post.threadId, authorId);
    const verdict = subjectGateVerdict(facts, now);
    if (verdict === 'refuse' && facts.subject !== null) {
      await this.noticeOnce(post.threadId, authorId, facts, facts.subject);
    }
    return verdict === 'import';
  }

  /** The thread's subject facts + whether the author may write there. */
  loadFacts(threadId: number, authorId: string): Promise<SubjectGateFacts> {
    return loadSubjectGateFacts(this.db, threadId, authorId);
  }

  /** Claim the Redis key; only the claimer DMs. Never throws. */
  private async noticeOnce(
    threadId: number,
    discordId: string,
    facts: SubjectGateFacts,
    subject: GateSubject,
  ): Promise<void> {
    const key = eventNoticeKey(threadId, discordId);
    const ttl = EVENT_NOTICE_TTL_SECONDS;
    try {
      const claimed = await this.redis.set(key, '1', 'EX', ttl, 'NX');
      if (claimed !== 'OK') return;
      const url = `${await getClientUrl(this.settings)}${facts.path}`;
      const embed = createDmEmbed({ state: 'needs_you' })
        .setTitle(facts.title)
        .setDescription(subjectNoticeText(subject.kind, facts.title, url))
        .setURL(url);
      await this.client.sendEmbedDM(discordId, embed);
    } catch (err) {
      if (isClosedDms(err)) return;
      const why = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Forum thread ${threadId} notice DM failed: ${why}`);
    }
  }
}
