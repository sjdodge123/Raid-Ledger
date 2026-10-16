import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SettingsService } from '../../../settings/settings.service';
import {
  EXTENSION_POINTS,
  type GameLogParser,
} from '../../plugin-host/extension-points';
import { PLUGIN_EVENTS } from '../../plugin-host/plugin-manifest.interface';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  PELICAN_PLUGIN_ID,
  PELICAN_PRESENCE_CONFIG_CHANGED,
} from '../pelican.constants';
import { PelicanClientFactory } from '../pelican-client.factory';
import type { ConsoleCredentialsSource } from '../pelican-console-socket';
import type { WingsSocketFactory } from '../pelican-console-socket.helpers';
import { errName, PRESENCE_STOPPED_STATES } from './pelican-presence.helpers';
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

interface Plan {
  targets: Map<number, Target>;
  /** Tracked servers Pelican reports offline/stopping. */
  stopped: PresenceServerRow[];
}

/**
 * Pelican presence supervisor (ROK-1800 L5, ROK-1798 Q5). Holds one console
 * session per eligible server: `presence_tracking` on, still listed, not
 * suspended, state `running`, and a game whose slug has an active
 * `game-log-parser`. Nothing runs while the Pelican plugin is inactive or
 * unconfigured, Quick Play (`AD_HOC_EVENTS_ENABLED`) is off, or no
 * `SERVER_PRESENCE_SINK` is bound. Reconciled on boot and after every status
 * poll; every session stops (without emptying) when Pelican is deactivated.
 * Assumes a single API process (Q5).
 */
@Injectable()
export class PelicanPresenceSupervisor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PelicanPresenceSupervisor.name);
  private readonly sessions = new Map<number, Running>();
  /** Stopped servers already emptied this offline spell (once each). */
  private readonly emptiedStopped = new Set<number>();
  private reconciling = false;
  /** A reconcile was asked for while one ran — run once more after it. */
  private rerun = false;
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
    await this.stopAll();
  }

  /**
   * Pelican deactivated: its status-poll cron (the reconcile trigger) is
   * removed, so close every socket now. Like shutdown this does NOT empty:
   * deactivation stops observing, it is no evidence anyone left, and ending
   * live Quick Plays for players still on the server would be a false
   * departure. Reactivation's first reconcile rehydrates the roster.
   */
  @OnEvent(PLUGIN_EVENTS.DEACTIVATED)
  async handlePluginDeactivated(payload: { slug: string }): Promise<void> {
    if (payload.slug !== PELICAN_PLUGIN_ID) return;
    await this.stopAll();
  }

  /**
   * An admin flipped a server's Quick Play switch or game (ROK-1800 n4):
   * apply it now rather than at the next 2-minute status poll.
   */
  @OnEvent(PELICAN_PRESENCE_CONFIG_CHANGED)
  async handlePresenceConfigChanged(): Promise<void> {
    await this.reconcile();
  }

  private async stopAll(): Promise<void> {
    const all = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(all.map((r) => r.session.stop(false)));
  }

  /**
   * Start/stop sessions to match eligibility. Never throws; never overlaps —
   * a call that lands mid-run is folded into one more pass, so a change
   * made during a reconcile is never dropped until the next poll.
   */
  async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.rerun = true;
      return;
    }
    this.reconciling = true;
    try {
      do {
        this.rerun = false;
        await this.reconcileOnce();
      } while (this.rerun);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(): Promise<void> {
    try {
      const plan = await this.desired();
      await this.apply(plan.targets);
      await this.emptyStopped(plan.stopped);
    } catch (err) {
      this.logger.error(`Presence reconcile failed: ${errName(err)}`);
    }
  }

  private async apply(desired: Map<number, Target>): Promise<void> {
    for (const [id, running] of [...this.sessions]) {
      if (desired.get(id)?.key === running.key) continue;
      this.sessions.delete(id);
      this.emptiedStopped.add(id);
      await running.session.stop(true);
    }
    for (const [id, target] of desired) {
      if (!this.sessions.has(id)) await this.startSession(target);
    }
  }

  private async desired(): Promise<Plan> {
    const plan: Plan = { targets: new Map(), stopped: [] };
    const panelUrl = await this.enabledPanelUrl();
    if (!panelUrl) return plan;
    for (const row of await this.repo.listTracked()) {
      const parser = this.eligibleParser(row);
      if (parser) {
        const key = `${row.identifier}|${row.gameId}|${row.gameSlug}|${panelUrl}`;
        plan.targets.set(row.id, { row, parser, key });
        this.emptiedStopped.delete(row.id);
      } else if (PRESENCE_STOPPED_STATES.has(row.currentState ?? '')) {
        plan.stopped.push(row);
      }
    }
    return plan;
  }

  /** The panel URL when presence may run at all, else null. */
  private async enabledPanelUrl(): Promise<string | null> {
    if (!this.sinkBound()) return null;
    if (!this.registry.isActive(PELICAN_PLUGIN_ID)) return null;
    if (!(await this.settings.getAdHocEventsEnabled())) return null;
    return this.factory.panelUrl();
  }

  /**
   * A server that stopped while no session watched it (e.g. while the API
   * was down) still has persisted presence: empty it once per offline spell.
   */
  private async emptyStopped(rows: PresenceServerRow[]): Promise<void> {
    for (const row of rows) {
      if (this.sessions.has(row.id) || this.emptiedStopped.has(row.id)) {
        continue;
      }
      const source = { pelicanServerId: row.id, gameId: row.gameId };
      try {
        const open = (await this.sink?.openPresence(source)) ?? [];
        if (open.length > 0) await this.sink?.serverEmptied(source);
        // Only a cleanup that succeeded counts: a failure retries next poll.
        this.emptiedStopped.add(row.id);
      } catch (err) {
        this.logger.error(
          `Presence empty failed for stopped server ${row.id}: ${errName(err)}`,
        );
      }
    }
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
    // Deactivated mid-reconcile: never open a socket nothing will close.
    if (!this.registry.isActive(PELICAN_PLUGIN_ID)) return;
    const { row, parser, key } = target;
    const session = new PelicanPresenceSession({
      source: { pelicanServerId: row.id, gameId: row.gameId },
      serverIdentifier: row.identifier,
      panelUrl,
      getCredentials: (id) => this.currentCredentials(id),
      parser,
      sink: this.sink,
      logger: this.logger,
      ...(this.socketFactory ? { socketFactory: this.socketFactory } : {}),
    });
    this.sessions.set(row.id, { session, key });
    await session.start();
  }

  /**
   * Socket credentials from the client configured NOW, so a rotated API key
   * applies at the next token refresh/reconnect without restarting the
   * session (a restart would clear presence and end live Quick Plays).
   */
  private async currentCredentials(
    serverIdentifier: string,
  ): ReturnType<ConsoleCredentialsSource> {
    const conn = await this.factory.connect();
    if (!conn) throw new Error('Pelican client unconfigured');
    return conn.client.getWebsocketCredentials(serverIdentifier);
  }
}
