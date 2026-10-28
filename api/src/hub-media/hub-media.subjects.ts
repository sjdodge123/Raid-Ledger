import { BadRequestException, Injectable } from '@nestjs/common';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

/**
 * ROK-2027 D2/D4 — a plugin's resolver for one `?subject=<namespace>:<payload>`
 * Gallery scope: the hub's media ids in that subject (visibility-agnostic —
 * core still applies its own hidden/removed/other-hub rules), `[]` for a
 * well-formed key that matches nothing, or `null` for a payload it refuses.
 */
export type HubMediaSubjectResolver = (ctx: {
  guildId: number;
  payload: string;
}) => Promise<number[] | null>;

interface OwnedResolver {
  ownerPluginId: string;
  resolve: HubMediaSubjectResolver;
}

const INVALID_QUERY = 'Invalid query';

/**
 * ROK-2027 — core stays game-agnostic: a plugin registers a namespace and
 * core asks it for ids. ROK-1969: each resolver names its owner plugin and
 * is refused (400, D6) while that plugin is off — the decorator precedent.
 */
@Injectable()
export class HubMediaSubjectRegistry {
  private readonly resolvers = new Map<string, OwnedResolver>();

  constructor(private readonly plugins: PluginRegistryService) {}

  /** Register `resolver` for `namespace`, owned by `ownerPluginId` (a plugin slug, or `core`). */
  register(
    ownerPluginId: string,
    namespace: string,
    resolver: HubMediaSubjectResolver,
  ): void {
    if (this.resolvers.has(namespace)) {
      throw new Error(`hub media subject "${namespace}" is already registered`);
    }
    this.resolvers.set(namespace, { ownerPluginId, resolve: resolver });
  }

  /** The media ids of `subject` on hub `guildId`; 400 when unknown, owner off, or refused. */
  async resolve(guildId: number, subject: string): Promise<number[]> {
    const at = subject.indexOf(':');
    const entry = at > 0 ? this.resolvers.get(subject.slice(0, at)) : undefined;
    if (!entry || !this.plugins.isActive(entry.ownerPluginId)) {
      throw new BadRequestException(INVALID_QUERY);
    }
    const ids = await entry.resolve({ guildId, payload: subject.slice(at + 1) });
    if (ids === null) throw new BadRequestException(INVALID_QUERY);
    return ids;
  }
}
