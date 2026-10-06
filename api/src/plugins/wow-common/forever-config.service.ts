import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { WowForeverConfigSchema } from '@raid-ledger/contract';
import type {
  BlizzardCapabilitiesDto,
  WowForeverConfigDto,
  WowForeverConfigResponseDto,
} from '@raid-ledger/contract';
import { bestEffortInit } from '../../common/lifecycle.util';
import { SettingsService } from '../../settings/settings.service';
import { BlizzardService } from './blizzard.service';
import {
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';
import {
  WOW_FOREVER_ARMORY_IMPORT_KEY,
  WOW_FOREVER_CONFIG_UPDATED,
  WOW_FOREVER_NAMESPACE_PREFIX_KEY,
  type WowForeverConfigUpdatedPayload,
} from './forever.settings';

/**
 * Admin-controlled WoW: Forever runtime config (ROK-1717): the Blizzard
 * namespace prefix (resolved at the call edge) and the Armory-import flag.
 * Only an admin changes these — nothing automatic writes them (D7).
 */
@Injectable()
export class ForeverConfigService implements OnModuleInit {
  private readonly logger = new Logger(ForeverConfigService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly blizzard: BlizzardService,
    private readonly events: EventEmitter2,
  ) {}

  /** Load the stored prefix into the resolver; a failure keeps the default. */
  async onModuleInit(): Promise<void> {
    await bestEffortInit(
      'ForeverConfigService: load prefix',
      this.logger,
      async () => {
        const stored = await this.settings.get(
          WOW_FOREVER_NAMESPACE_PREFIX_KEY,
        );
        setForeverNamespacePrefix(stored);
      },
    );
  }

  /** Current config as the admin form shows it. */
  async getConfig(): Promise<WowForeverConfigResponseDto> {
    const stored = await this.settings.get(WOW_FOREVER_NAMESPACE_PREFIX_KEY);
    const namespacePrefix = stored || FOREVER_NAMESPACE_ALIAS;
    return {
      namespacePrefix,
      namespacePrefixIsDefault: namespacePrefix === FOREVER_NAMESPACE_ALIAS,
      armoryImportEnabled: await this.isArmoryImportEnabled(),
    };
  }

  /**
   * Validate + persist the config, then announce it. The default prefix and a
   * disabled flag are stored as an absent key.
   * @throws BadRequestException when the body fails the contract schema.
   */
  async updateConfig(
    dto: WowForeverConfigDto,
  ): Promise<WowForeverConfigResponseDto> {
    const parsed = WowForeverConfigSchema.safeParse(dto);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const { namespacePrefix, armoryImportEnabled } = parsed.data;
    await this.writeOrDelete(
      WOW_FOREVER_NAMESPACE_PREFIX_KEY,
      namespacePrefix === FOREVER_NAMESPACE_ALIAS ? null : namespacePrefix,
    );
    await this.writeOrDelete(
      WOW_FOREVER_ARMORY_IMPORT_KEY,
      armoryImportEnabled ? 'true' : null,
    );
    const payload: WowForeverConfigUpdatedPayload = { namespacePrefix };
    this.events.emit(WOW_FOREVER_CONFIG_UPDATED, payload);
    return this.getConfig();
  }

  /** Point the resolver at the new prefix and drop realm state for old + new. */
  @OnEvent(WOW_FOREVER_CONFIG_UPDATED)
  handleConfigUpdated(payload: WowForeverConfigUpdatedPayload): void {
    const previous = getForeverNamespacePrefix();
    setForeverNamespacePrefix(payload.namespacePrefix);
    this.blizzard.purgeNamespace(previous);
    this.blizzard.purgeNamespace(getForeverNamespacePrefix());
    this.logger.log(
      `Forever namespace prefix: ${previous} -> ${getForeverNamespacePrefix()}`,
    );
  }

  /** Public capability flags the Add Character flow reads. */
  async getCapabilities(): Promise<BlizzardCapabilitiesDto> {
    return {
      armoryImport: { wow_forever: await this.isArmoryImportEnabled() },
    };
  }

  private async isArmoryImportEnabled(): Promise<boolean> {
    return (await this.settings.get(WOW_FOREVER_ARMORY_IMPORT_KEY)) === 'true';
  }

  private async writeOrDelete(
    key: typeof WOW_FOREVER_ARMORY_IMPORT_KEY,
    value: string | null,
  ): Promise<void> {
    if (value === null) await this.settings.delete(key);
    else await this.settings.set(key, value);
  }
}
