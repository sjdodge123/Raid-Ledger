import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import type {
  HubMediaCorrelation,
  HubMediaHubRef,
  HubMediaPostClassification,
  HubMediaPostClassifier,
  HubMediaPostText,
  HubMediaStoredContext,
} from '../../../hub-media/hub-media-classifier.registry';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { ValheimDeathLinkRepository } from './valheim-death-link.repository';
import {
  captureSecondOfHour,
  classifyPost,
  postText,
} from './valheim-screenshot.parse';

type Db = PostgresJsDatabase<typeof schema>;
const { valheimPlayerDeaths } = schema;
const CAPTION_MAX = 200;

type ValheimServerHub = HubMediaHubRef & { pelicanServerId: number };

/** A Valheim server hub: deaths can only be keyed to its Pelican server. */
const isValheimServer = (hub: HubMediaHubRef): hub is ValheimServerHub =>
  hub.gameSlug === VALHEIM_GAME_SLUG && hub.pelicanServerId !== null;

/**
 * ROK-1941 — the screenshot mod's posts on a Valheim server hub: `death` /
 * `screenshot` by wording (D5), the first death picture correlated to a
 * console death (L1 SQL A), and a deleted post's inferred death removed (D11).
 * ROK-1969: classifying and linking are no-ops while the Valheim plugin is
 * inactive; removal cleanup is not (see `afterRemove`).
 */
@Injectable()
export class ValheimScreenshotClassifier implements HubMediaPostClassifier {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly links: ValheimDeathLinkRepository,
    private readonly plugins: PluginRegistryService,
  ) {}

  /** A Valheim server hub while the Valheim plugin is active (ROK-1969). */
  private owns(hub: HubMediaHubRef): hub is ValheimServerHub {
    return isValheimServer(hub) && this.plugins.isActive(VALHEIM_PLUGIN_ID);
  }

  /** Null for a non-Valheim hub, an inactive plugin, or a post the mod did not write. */
  classify(
    post: HubMediaPostText,
    hub: HubMediaHubRef,
  ): HubMediaPostClassification | null {
    if (!this.owns(hub)) return null;
    const text = postText(post.content, post.embeds);
    const c = classifyPost(text);
    if (c.kind === 'image') return null;
    return {
      kind: c.kind,
      authorName: c.name,
      caption: text.slice(0, CAPTION_MAX),
    };
  }

  /** D6: only a death post's first picture links (or infers) a death. */
  async afterStore(ctx: HubMediaStoredContext): Promise<HubMediaCorrelation> {
    const { hub, classification: c } = ctx;
    if (c.kind !== 'death' || ctx.index !== 0) return null;
    if (!this.owns(hub) || !c.authorName) return null;
    const res = await this.links.linkOrInferDeath({
      pelicanServerId: hub.pelicanServerId,
      characterName: c.authorName,
      postedAt: ctx.post.createdAt,
      hubMediaId: ctx.mediaId,
      captureSecondOfHour: ctx.filename
        ? captureSecondOfHour(ctx.filename)
        : null,
    });
    return res.outcome;
  }

  /**
   * D11: the post was an inferred death's only evidence; log/mod rows stay.
   * Runs even while the plugin is off: it only deletes `discord` rows already
   * linked to these pictures (cleanup, not classification), so a post deleted
   * during an inactive window cannot leave an evidence-less death behind.
   */
  async afterRemove(
    hub: HubMediaHubRef,
    mediaIds: readonly number[],
  ): Promise<void> {
    if (!isValheimServer(hub) || mediaIds.length === 0) return;
    await this.db
      .delete(valheimPlayerDeaths)
      .where(
        and(
          eq(valheimPlayerDeaths.pelicanServerId, hub.pelicanServerId),
          inArray(valheimPlayerDeaths.hubMediaId, [...mediaIds]),
          eq(valheimPlayerDeaths.source, 'discord'),
        ),
      );
  }
}
