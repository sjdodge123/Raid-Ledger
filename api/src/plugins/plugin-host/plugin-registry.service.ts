import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { defined } from '../../common/defined.helpers';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { plugins } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { isMissingTableError } from '../../common/pg-error.helpers';
import { PluginManifest, PLUGIN_EVENTS } from './plugin-manifest.interface';
import { PluginInfoDto } from '@raid-ledger/contract';
import {
  resolveIntegrationInfo,
  cleanupPluginSettings,
  validateDependencies,
} from './plugin-registry.helpers';
import {
  PluginAdapterStore,
  type AdapterRegistrationOptions,
} from './plugin-adapter-store';

/** A suspended adapter's owning plugin, named for an admin hint (ROK-1819). */
export interface SuspendedAdapterOwner {
  pluginId: string;
  pluginName: string;
}

@Injectable()
export class PluginRegistryService implements OnModuleInit {
  private readonly logger = new Logger(PluginRegistryService.name);
  private manifests = new Map<string, PluginManifest>();
  private activeSlugs = new Set<string>();
  private readonly store = new PluginAdapterStore((id) =>
    this.activeSlugs.has(id),
  );

  constructor(
    @Inject(DrizzleAsyncProvider) private db: PostgresJsDatabase<typeof schema>,
    private eventEmitter: EventEmitter2,
  ) {}

  // STARTUP-CRITICAL: Plugin registry must be loaded for all plugin modules to register. @see bestEffortInit
  async onModuleInit(): Promise<void> {
    await this.refreshActiveCache();
  }

  registerManifest(manifest: PluginManifest): void {
    this.manifests.set(manifest.id, manifest);
    this.logger.debug(
      `Registered plugin manifest: ${manifest.id} v${manifest.version}`,
    );
  }

  /** Ensure a plugin is installed in the DB. No-op if already present. */
  async ensureInstalled(slug: string): Promise<void> {
    const manifest = this.manifests.get(slug);
    if (!manifest) return;
    const existing = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);
    if (existing.length > 0) return;
    const now = new Date();
    await this.db.insert(plugins).values({
      slug,
      name: manifest.name,
      version: manifest.version,
      active: true,
      installedAt: now,
      updatedAt: now,
    });
    await this.refreshActiveCache();
    this.logger.debug(`Auto-installed built-in plugin: ${slug}`);
  }

  getManifest(slug: string): PluginManifest | undefined {
    return this.manifests.get(slug);
  }

  /** List all registered plugins with their DB state and integration info. */
  async listPlugins(): Promise<PluginInfoDto[]> {
    const dbRecords = await this.db.select().from(plugins);
    const recordMap = new Map(dbRecords.map((r) => [r.slug, r]));
    const result: PluginInfoDto[] = [];
    for (const [slug, manifest] of this.manifests) {
      const record = recordMap.get(slug);
      const integrations = await resolveIntegrationInfo(this.db, manifest);
      result.push({
        slug,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        gameSlugs: manifest.gameSlugs ?? [],
        capabilities: manifest.capabilities,
        integrations,
        status: record
          ? record.active
            ? 'active'
            : 'inactive'
          : 'not_installed',
        installedAt: record?.installedAt?.toISOString() ?? null,
      });
    }
    return result;
  }

  /** Install a plugin, validating manifest and dependencies. */
  async install(slug: string): Promise<typeof plugins.$inferSelect> {
    const manifest = this.manifests.get(slug);
    if (!manifest)
      throw new NotFoundException(`Plugin manifest "${slug}" not found`);
    const existing = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);
    if (existing.length > 0)
      throw new BadRequestException(`Plugin "${slug}" is already installed`);
    await validateDependencies(this.db, manifest, slug);

    const now = new Date();
    const [record] = await this.db
      .insert(plugins)
      .values({
        slug,
        name: manifest.name,
        version: manifest.version,
        active: true,
        installedAt: now,
        updatedAt: now,
      })
      .returning();
    await this.refreshActiveCache();
    this.eventEmitter.emit(PLUGIN_EVENTS.INSTALLED, { slug, manifest });
    this.logger.log(`Plugin installed and activated: ${slug}`);
    return defined(record, 'installed plugin row');
  }

  /** Uninstall a plugin (must be deactivated first). */
  async uninstall(slug: string): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);
    if (!existing)
      throw new NotFoundException(`Plugin "${slug}" is not installed`);
    if (existing.active)
      throw new BadRequestException(
        `Plugin "${slug}" must be deactivated before uninstalling`,
      );

    const manifest = this.manifests.get(slug);
    if (manifest) {
      const count = await cleanupPluginSettings(this.db, manifest);
      if (count > 0)
        this.logger.debug(
          `Cleaned up ${count} setting(s) for plugin "${manifest.id}"`,
        );
    }
    await this.db.delete(plugins).where(eq(plugins.slug, slug));
    await this.refreshActiveCache();
    this.eventEmitter.emit(PLUGIN_EVENTS.UNINSTALLED, { slug });
    this.logger.log(`Plugin uninstalled: ${slug}`);
  }

  /** Activate an installed plugin. */
  async activate(slug: string): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);
    if (!existing)
      throw new NotFoundException(`Plugin "${slug}" is not installed`);
    if (existing.active) return;
    await this.db
      .update(plugins)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(plugins.slug, slug));
    await this.refreshActiveCache();
    // Restore before the emit so ACTIVATED listeners see the adapters (ROK-268).
    this.store.restoreAdaptersOwnedBy(slug);
    this.eventEmitter.emit(PLUGIN_EVENTS.ACTIVATED, { slug });
    this.logger.log(`Plugin activated: ${slug}`);
  }

  /** Deactivate an installed plugin. */
  async deactivate(slug: string): Promise<void> {
    const [existing] = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);
    if (!existing)
      throw new NotFoundException(`Plugin "${slug}" is not installed`);
    if (!existing.active) return;
    await this.db
      .update(plugins)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(plugins.slug, slug));
    await this.refreshActiveCache();
    // Owned adapters first, so one keyed by a game slug is suspended (and
    // restored on activate) rather than hard-deleted below (ROK-268).
    this.store.suspendAdaptersOwnedBy(slug);
    const manifest = this.manifests.get(slug);
    if (manifest) this.removeAdaptersForPlugin(manifest.gameSlugs ?? []);
    this.eventEmitter.emit(PLUGIN_EVENTS.DEACTIVATED, { slug });
    this.logger.log(`Plugin deactivated: ${slug}`);
  }

  /** `opts.ownerPluginId` ties the adapter to a plugin's activate/deactivate (ROK-268). */
  registerAdapter<T>(
    extensionPoint: string,
    gameSlug: string,
    adapter: T,
    opts?: AdapterRegistrationOptions,
  ): void {
    this.store.registerAdapter(extensionPoint, gameSlug, adapter, opts);
    this.logger.debug(
      `Registered adapter: ${extensionPoint} for game slug "${gameSlug}"`,
    );
  }

  getAdapter<T>(extensionPoint: string, gameSlug: string): T | undefined {
    return this.store.getAdapter<T>(extensionPoint, gameSlug);
  }

  /**
   * The inactive plugin whose adapter would serve `extensionPoint`/`gameSlug`
   * once activated, or undefined when one is live or none exists (ROK-1819).
   */
  getSuspendedAdapterOwner(
    extensionPoint: string,
    gameSlug: string,
  ): SuspendedAdapterOwner | undefined {
    if (this.store.getAdapter(extensionPoint, gameSlug) !== undefined)
      return undefined;
    const pluginId = this.store.findSuspendedOwner(extensionPoint, gameSlug);
    if (pluginId === undefined) return undefined;
    const pluginName = this.manifests.get(pluginId)?.name ?? pluginId;
    return { pluginId, pluginName };
  }

  getAdaptersForExtensionPoint<T>(extensionPoint: string): Map<string, T> {
    return this.store.getAdaptersForExtensionPoint<T>(extensionPoint);
  }

  /** Idempotent per instance. `opts.ownerPluginId` as for registerAdapter. */
  registerMultiAdapter<T>(
    extensionPoint: string,
    gameSlug: string,
    adapter: T,
    opts?: AdapterRegistrationOptions,
  ): void {
    const total = this.store.registerMultiAdapter(
      extensionPoint,
      gameSlug,
      adapter,
      opts,
    );
    this.logger.debug(
      `Registered multi-adapter: ${extensionPoint} for game slug "${gameSlug}" (${total} total)`,
    );
  }

  getMultiAdapters<T>(extensionPoint: string, gameSlug: string): T[] {
    return this.store.getMultiAdapters<T>(extensionPoint, gameSlug);
  }

  removeAdaptersForPlugin(gameSlugs: string[] = []): void {
    this.store.removeByKeys(gameSlugs);
    this.logger.debug(
      `Removed adapters for game slugs: ${gameSlugs.join(', ')}`,
    );
  }

  isActive(slug: string): boolean {
    return this.activeSlugs.has(slug);
  }
  getActiveSlugsSync(): ReadonlySet<string> {
    return this.activeSlugs;
  }

  private async refreshActiveCache(): Promise<void> {
    try {
      const activeRecords = await this.db
        .select({ slug: plugins.slug })
        .from(plugins)
        .where(eq(plugins.active, true));
      this.activeSlugs = new Set(activeRecords.map((r) => r.slug));
    } catch (error: unknown) {
      if (isMissingTableError(error)) {
        this.logger.warn(
          'plugins table not found — plugin system disabled until migration is applied',
        );
        this.activeSlugs = new Set<string>();
      } else throw error;
    }
    // Adapters registered before their owner was known active (ROK-268).
    this.store.restoreActiveOwners();
  }
}
