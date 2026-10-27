import { Injectable } from '@nestjs/common';
import type { HubMediaKind } from '@raid-ledger/contract';

/** The hub a bound media channel feeds (hub ↔ Pelican server is 1:1). */
export interface HubMediaHubRef {
  guildId: number;
  pelicanServerId: number | null;
  /** The hub game's `games.slug` — a plugin claims only its own game's posts. */
  gameSlug: string | null;
}

/** The text slice of a source post a classifier reads (D5). */
export interface HubMediaPostText {
  id: string;
  createdAt: Date;
  content: string;
  embeds: readonly { description: string | null; title: string | null }[];
}

/** What a classifier decided about a post (kind is fixed per post). */
export interface HubMediaPostClassification {
  kind: HubMediaKind;
  authorName: string | null;
  caption: string | null;
}

/** One picture of a classified post that is now in the store. */
export interface HubMediaStoredContext {
  hub: HubMediaHubRef;
  post: HubMediaPostText;
  classification: HubMediaPostClassification;
  mediaId: number;
  /** 0 = the post's first image (D6: the one a death links to). */
  index: number;
  filename: string | null;
}

/** A source record the picture was tied to, or null when none. */
export type HubMediaCorrelation = 'linked' | 'inferred' | 'already' | null;

/**
 * ROK-1941 D3 — the port a game plugin implements so core never imports it.
 * `classify` returns null for a post it does not recognise.
 */
export interface HubMediaPostClassifier {
  classify(
    post: HubMediaPostText,
    hub: HubMediaHubRef,
  ): HubMediaPostClassification | null;
  afterStore(ctx: HubMediaStoredContext): Promise<HubMediaCorrelation>;
  /** The source post was deleted; these media rows were just tombstoned (D11). */
  afterRemove(hub: HubMediaHubRef, mediaIds: readonly number[]): Promise<void>;
}

/** The classifier that claimed a post (null = core's `image` default). */
export interface HubMediaClassified {
  classification: HubMediaPostClassification;
  classifier: HubMediaPostClassifier | null;
}

const DEFAULT_CLASSIFICATION: HubMediaPostClassification = {
  kind: 'image',
  authorName: null,
  caption: null,
};

/**
 * ROK-1941 D3 — shaped like `HubMediaDecoratorRegistry`: plugins register on
 * module init; the first classifier that recognises a post wins, else `image`.
 */
@Injectable()
export class HubMediaPostClassifierRegistry {
  private readonly classifiers: HubMediaPostClassifier[] = [];

  register(classifier: HubMediaPostClassifier): void {
    this.classifiers.push(classifier);
  }

  /** The post's kind/author/caption and the classifier that owns it. */
  classify(post: HubMediaPostText, hub: HubMediaHubRef): HubMediaClassified {
    for (const classifier of this.classifiers) {
      const classification = classifier.classify(post, hub);
      if (classification) return { classification, classifier };
    }
    return { classification: DEFAULT_CLASSIFICATION, classifier: null };
  }

  /** Tell every classifier a post's media were removed at the source. */
  async afterRemove(
    hub: HubMediaHubRef,
    mediaIds: readonly number[],
  ): Promise<void> {
    if (mediaIds.length === 0) return;
    for (const classifier of this.classifiers) {
      await classifier.afterRemove(hub, mediaIds);
    }
  }
}
