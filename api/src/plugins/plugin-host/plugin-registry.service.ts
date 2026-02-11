import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { plugins, appSettings } from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { PluginManifest, PLUGIN_EVENTS } from './plugin-manifest.interface';
import { PluginInfoDto, PluginIntegrationInfoDto } from '@raid-ledger/contract';

@Injectable()
export class PluginRegistryService implements OnModuleInit {
  private readonly logger = new Logger(PluginRegistryService.name);
  private manifests = new Map<string, PluginManifest>();
  private activeSlugs = new Set<string>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshActiveCache();
  }

  registerManifest(manifest: PluginManifest): void {
    this.manifests.set(manifest.id, manifest);
    this.logger.log(
      `Registered plugin manifest: ${manifest.id} v${manifest.version}`,
    );
  }

  getManifest(slug: string): PluginManifest | undefined {
    return this.manifests.get(slug);
  }

  async listPlugins(): Promise<PluginInfoDto[]> {
    const dbRecords = await this.db.select().from(plugins);
    const recordMap = new Map(dbRecords.map((r) => [r.slug, r]));

    const result: PluginInfoDto[] = [];

    for (const [slug, manifest] of this.manifests) {
      const record = recordMap.get(slug);
      const integrations = await this.resolveIntegrationInfo(manifest);

      result.push({
        slug,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        gameSlugs: manifest.gameSlugs,
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

  async install(slug: string): Promise<typeof plugins.$inferSelect> {
    const manifest = this.manifests.get(slug);
    if (!manifest) {
      throw new NotFoundException(`Plugin manifest "${slug}" not found`);
    }

    const existing = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      throw new BadRequestException(`Plugin "${slug}" is already installed`);
    }

    if (manifest.dependencies?.length) {
      for (const dep of manifest.dependencies) {
        const depRecord = await this.db
          .select()
          .from(plugins)
          .where(eq(plugins.slug, dep))
          .limit(1);
        if (depRecord.length === 0) {
          throw new BadRequestException(
            `Dependency "${dep}" must be installed before "${slug}"`,
          );
        }
      }
    }

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

    return record;
  }

  async uninstall(slug: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Plugin "${slug}" is not installed`);
    }

    if (existing[0].active) {
      throw new BadRequestException(
        `Plugin "${slug}" must be deactivated before uninstalling`,
      );
    }

    const manifest = this.manifests.get(slug);
    if (manifest) {
      await this.cleanupSettings(manifest);
    }

    await this.db.delete(plugins).where(eq(plugins.slug, slug));
    await this.refreshActiveCache();
    this.eventEmitter.emit(PLUGIN_EVENTS.UNINSTALLED, { slug });
    this.logger.log(`Plugin uninstalled: ${slug}`);
  }

  async activate(slug: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Plugin "${slug}" is not installed`);
    }

    if (existing[0].active) {
      return;
    }

    await this.db
      .update(plugins)
      .set({ active: true, updatedAt: new Date() })
      .where(eq(plugins.slug, slug));

    await this.refreshActiveCache();
    this.eventEmitter.emit(PLUGIN_EVENTS.ACTIVATED, { slug });
    this.logger.log(`Plugin activated: ${slug}`);
  }

  async deactivate(slug: string): Promise<void> {
    const existing = await this.db
      .select()
      .from(plugins)
      .where(eq(plugins.slug, slug))
      .limit(1);

    if (existing.length === 0) {
      throw new NotFoundException(`Plugin "${slug}" is not installed`);
    }

    if (!existing[0].active) {
      return;
    }

    await this.db
      .update(plugins)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(plugins.slug, slug));

    await this.refreshActiveCache();
    this.eventEmitter.emit(PLUGIN_EVENTS.DEACTIVATED, { slug });
    this.logger.log(`Plugin deactivated: ${slug}`);
  }

  isActive(slug: string): boolean {
    return this.activeSlugs.has(slug);
  }

  getActiveSlugsSync(): ReadonlySet<string> {
    return this.activeSlugs;
  }

  private async refreshActiveCache(): Promise<void> {
    const activeRecords = await this.db
      .select({ slug: plugins.slug })
      .from(plugins)
      .where(eq(plugins.active, true));

    this.activeSlugs = new Set(activeRecords.map((r) => r.slug));
  }

  private async resolveIntegrationInfo(
    manifest: PluginManifest,
  ): Promise<PluginIntegrationInfoDto[]> {
    if (!manifest.integrations?.length) {
      return [];
    }

    // Batch-fetch all credential keys in a single query
    const allCredentialKeys = manifest.integrations.flatMap(
      (i) => i.credentialKeys,
    );

    const existingKeys = new Set<string>();
    if (allCredentialKeys.length > 0) {
      const rows = await this.db
        .select({ key: appSettings.key })
        .from(appSettings)
        .where(inArray(appSettings.key, allCredentialKeys));
      for (const row of rows) {
        existingKeys.add(row.key);
      }
    }

    return manifest.integrations.map((integration) => ({
      key: integration.key,
      name: integration.name,
      description: integration.description,
      icon: integration.icon,
      configured: integration.credentialKeys.every((k) => existingKeys.has(k)),
      credentialLabels: integration.credentialLabels,
    }));
  }

  private async cleanupSettings(manifest: PluginManifest): Promise<void> {
    const keysToDelete: string[] = [...(manifest.settingKeys ?? [])];

    if (manifest.integrations) {
      for (const integration of manifest.integrations) {
        keysToDelete.push(...integration.credentialKeys);
      }
    }

    for (const key of keysToDelete) {
      await this.db.delete(appSettings).where(eq(appSettings.key, key));
    }

    if (keysToDelete.length > 0) {
      this.logger.log(
        `Cleaned up ${keysToDelete.length} setting(s) for plugin "${manifest.id}"`,
      );
    }
  }
}
