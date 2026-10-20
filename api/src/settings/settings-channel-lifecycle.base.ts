import type {
  ChannelLifecycleSettingsDto,
  UpdateChannelLifecycleSettingsDto,
} from '@raid-ledger/contract';
import type { SettingsCore } from './settings-bot.helpers';
import { CooptimusSettingsBase } from './settings-cooptimus.base';
import {
  getChannelLifecycleSettings as _getChannelLifecycleSettings,
  setChannelLifecycleSettings as _setChannelLifecycleSettings,
  recordChannelLifecycleRun as _recordChannelLifecycleRun,
  type ChannelLifecycleRunRecord,
} from './settings-channel-lifecycle.helpers';

/**
 * ROK-1429 (ROK-1428 L2): Discord channel lifecycle settings delegations,
 * extracted from SettingsService so that file stays under the STRICT 300-line
 * cap (same chain as `CooptimusSettingsBase` → `EphemeralVoiceSettingsBase`,
 * so SettingsService keeps a single `extends` clause).
 *
 * At runtime `this` is the concrete service, which satisfies SettingsCore.
 */
export abstract class ChannelLifecycleSettingsBase extends CooptimusSettingsBase {
  private get lifecycleCore(): SettingsCore {
    return this as unknown as SettingsCore;
  }

  /** The lifecycle settings group; defaults fill every gap (automation OFF). */
  getChannelLifecycleSettings = (): Promise<ChannelLifecycleSettingsDto> =>
    _getChannelLifecycleSettings(this.lifecycleCore);

  /** Validate + apply a partial update; throws BadRequestException when invalid. */
  setChannelLifecycleSettings = (
    patch: UpdateChannelLifecycleSettingsDto | Record<string, unknown>,
  ): Promise<ChannelLifecycleSettingsDto> =>
    _setChannelLifecycleSettings(this.lifecycleCore, patch);

  /** Record a reconcile run for the admin health line (null error clears it). */
  recordChannelLifecycleRun = (run: ChannelLifecycleRunRecord): Promise<void> =>
    _recordChannelLifecycleRun(this.lifecycleCore, run);
}
