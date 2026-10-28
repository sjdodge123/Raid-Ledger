import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ValheimDeathPlayerSchema } from '@raid-ledger/contract';
import {
  HubMediaSubjectRegistry,
  type HubMediaSubjectResolver,
} from '../../../../hub-media/hub-media.subjects';
import { VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import {
  type DeathCounts,
  ValheimDeathsRepository,
} from '../valheim-deaths.repository';
import { ValheimDeathsPicturesRepository } from './valheim-deaths-pictures.repository';
import {
  bucketsForBarKey,
  type DeathBucketRef,
} from './valheim-deaths.mappers';

/** ROK-2027 D1 — `?subject=valheim-death:<Deaths bar key>`. */
const VALHEIM_DEATH_SUBJECT = 'valheim-death';

/** What the resolver reads: the server's death buckets and their pictures. */
export interface DeathSubjectDeps {
  countByPlayer(serverId: number): Promise<DeathCounts>;
  serverIdOfHub(guildId: number): Promise<number | null>;
  mediaIdsFor(serverId: number, buckets: DeathBucketRef[]): Promise<number[]>;
}

/**
 * ROK-2027 D1/D6 — a malformed bar key → null (400); a hub with no server
 * or no bar with that key → [] (an empty scoped page). Otherwise every
 * media id linked to the bar's deaths, hidden or not: core's `visible()`
 * applies the Gallery's own visibility (D4).
 */
export function deathSubjectResolver(
  deps: DeathSubjectDeps,
): HubMediaSubjectResolver {
  return async ({ guildId, payload }) => {
    if (!ValheimDeathPlayerSchema.shape.key.safeParse(payload).success)
      return null;
    const serverId = await deps.serverIdOfHub(guildId);
    if (serverId === null) return [];
    const counts = await deps.countByPlayer(serverId);
    const buckets = bucketsForBarKey(counts, payload);
    if (buckets.length === 0) return [];
    return deps.mediaIdsFor(serverId, buckets);
  };
}

/** Registers the Valheim death subject on core's port (ROK-1969: owned by Valheim). */
@Injectable()
export class ValheimDeathsGallerySubject implements OnModuleInit {
  constructor(
    private readonly subjects: HubMediaSubjectRegistry,
    private readonly deaths: ValheimDeathsRepository,
    private readonly pictures: ValheimDeathsPicturesRepository,
  ) {}

  onModuleInit(): void {
    const resolver = deathSubjectResolver({
      countByPlayer: (s) => this.deaths.countByPlayer(s),
      serverIdOfHub: (g) => this.pictures.serverIdOfHub(g),
      mediaIdsFor: (s, b) => this.pictures.mediaIdsFor(s, b),
    });
    this.subjects.register(VALHEIM_PLUGIN_ID, VALHEIM_DEATH_SUBJECT, resolver);
  }
}
