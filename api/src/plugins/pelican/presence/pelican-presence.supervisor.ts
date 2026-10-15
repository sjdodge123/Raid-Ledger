import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { SettingsService } from '../../../settings/settings.service';
import {
  EXTENSION_POINTS,
  type GameLogParser,
} from '../../plugin-host/extension-points';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../pelican.constants';
import { PelicanClientFactory } from '../pelican-client.factory';
import type { WingsSocketFactory } from '../pelican-console-socket.helpers';
import { errName } from './pelican-presence.helpers';
import {
  PelicanPresenceRepository,
  type PresenceServerRow,
} from './pelican-presence.repository';
import { PelicanPresenceSession } from './pelican-presence.session';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
} from './server-presence.sink';

/** Optional override of the Wings socket factory (specs only). */
export const PRESENCE_SOCKET_FACTORY = Symbol('PRESENCE_SOCKET_FACTORY');

interface Target {
  row: PresenceServerRow;
  parser: GameLogParser;
  /** Changes when anything the open socket depends on changes. */
  key: string;
}

interface Running {
  session: PelicanPresenceSession;
  key: string;
}

/**
 * Pelican presence supervisor (ROK-1800 L5, ROK-1798 Q5). Holds one console
 * session per eligible server: `presence_tracking` on, still listed, not
 * suspended, state `running`, and a game whose slug has an active
 * `game-log-parser`. Nothing runs while the Pelican plugin is inactive or
 * unconfigured, Quick Play (`AD_HOC_EVENTS_ENABLED`) is off, or no
 * `SERVER_PRESENCE_SINK` is bound. Reconciled on boot and after every status
 * poll. Assumes a single API process (Q5).
 */
@Injectable()
export class PelicanPresenceSupervisor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PelicanPresenceSupervisor.name);
  private readonly sessions = new Map<number, Running>();
  private reconciling = false;
  private warnedNoSink = false;

  constructor(
    private readonly registry: PluginRegistryService,
    private readonly factory: PelicanClientFactory,
    private readonly repo: PelicanPresenceRepository,
    private readonly settings: SettingsService,
    @Optional()
    @Inject(SERVER_PRESENCE_SINK)
    private readonly sink: ServerPresenceSink | null = null,
    @Optional()
    @Inject(PRESENCE_SOCKET_FACTORY)
    private readonly socketFactory: WingsSocketFactory | null = null,
  ) {}

  /** Server ids with an open session. */
  get activeServerIds(): number[] {
    return [...this.sessions.keys()];
  }

  onApplicationBootstrap(): void {
    void this.reconcile();
  }

  /** App shutdown: close sockets WITHOUT emptying — a restart rehydrates. */
  async onModuleDestroy(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((r) => r.session.stop(false)));
  }

  /** Start/stop sessions to match eligibility. Never throws; never overlaps. */
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.apply(await this.desired());
    } catch (err) {
      this.logger.error(`Presence reconcile failed: ${errName(err)}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async apply(desired: Map<number, Target>): Promise<void> {
    for (const [id, running] of [...this.sessions]) {
      if (desired.get(id)?.key === running.key) continue;
      this.sessions.delete(id);
      await running.session.stop(true);
    }
    for (const [id, target] of desired) {
      if (!this.sessions.has(id)) await this.startSession(target);
    }
  }

  private async desired(): Promise<Map<number, Target>> {
    const targets = new Map<number, Target>();
    if (!this.sinkBound()) return targets;
    if (!this.registry.isActive(PELICAN_PLUGIN_ID)) return targets;
    if (!(await this.settings.getAdHocEventsEnabled())) return targets;
    const panelUrl = await this.factory.panelUrl();
    if (!panelUrl) return targets;
    for (const row of await this.repo.listTracked()) {
      const parser = this.eligibleParser(row);
      if (!parser) continue;
      const key = `${row.identifier}|${row.gameId}|${row.gameSlug}|${panelUrl}`;
      targets.set(row.id, { row, parser, key });
    }
    return targets;
  }

  private sinkBound(): boolean {
    if (this.sink) return true;
    if (!this.warnedNoSink) {
      this.warnedNoSink = true;
      this.logger.warn('No SERVER_PRESENCE_SINK bound — presence tracking off');
    }
    return false;
  }

  private eligibleParser(row: PresenceServerRow): GameLogParser | null {
    if (row.isSuspended || row.currentState !== 'running') return null;
    const parser = this.registry.getAdapter<GameLogParser>(
      EXTENSION_POINTS.GAME_LOG_PARSER,
      row.gameSlug,
    );
    if (!parser || !this.registry.isActive(parser.pluginSlug)) return null;
    return parser;
  }

  private async startSession(target: Target): Promise<void> {
    const conn = await this.factory.connect();
    const panelUrl = await this.factory.panelUrl();
    if (!conn || !panelUrl || !this.sink) return;
    const { row, parser, key } = target;
    const session = new PelicanPresenceSession({
      source: { pelicanServerId: row.id, gameId: row.gameId },
      serverIdentifier: row.identifier,
      panelUrl,
      getCredentials: (id) => conn.client.getWebsocketCredentials(id),
      parser,
      sink: this.sink,
      logger: this.logger,
      ...(this.socketFactory ? { socketFactory: this.socketFactory } : {}),
    });
    this.sessions.set(row.id, { session, key });
    await session.start();
  }
}
