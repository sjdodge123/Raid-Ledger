import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import type { SettingsCore } from './settings-bot.helpers';
import { EphemeralVoiceSettingsBase } from './settings-ephemeral.base';

/**
 * Co-Optimus settings accessors — the ROK-1397 allowlisted user-agent and the
 * ROK-1398 editorial-prose opt-in — extracted from SettingsService so that file
 * stays under the STRICT 300-line cap (same pattern as
 * `EphemeralVoiceSettingsBase`, which this extends so SettingsService keeps a
 * single `extends` clause while each concern lives in its own file).
 *
 * At runtime `this` is the concrete service, which satisfies SettingsCore.
 */
export abstract class CooptimusSettingsBase extends EphemeralVoiceSettingsBase {
  private get coopCore(): SettingsCore {
    return this as unknown as SettingsCore;
  }

  /** Allowlisted user-agent Co-Optimus granted us (permission-first). */
  getCooptimusUserAgent = () =>
    this.coopCore.get(SETTING_KEYS.COOPTIMUS_USER_AGENT);
  setCooptimusUserAgent = (ua: string) =>
    this.coopCore.set(SETTING_KEYS.COOPTIMUS_USER_AGENT, ua);
  isCooptimusConfigured = () =>
    this.coopCore.exists(SETTING_KEYS.COOPTIMUS_USER_AGENT);
  clearCooptimusConfig = () =>
    this.coopCore.delete(SETTING_KEYS.COOPTIMUS_USER_AGENT);

  /**
   * ROK-1398: editorial-prose opt-in. Unset resolves to false — the grant
   * covers the co-op facts, so prose is stripped from API responses until the
   * operator explicitly turns this on.
   */
  getCooptimusProseEnabled = async (): Promise<boolean> =>
    (await this.coopCore.get(SETTING_KEYS.COOPTIMUS_PROSE_ENABLED)) === 'true';
  setCooptimusProseEnabled = (enabled: boolean) =>
    this.coopCore.set(
      SETTING_KEYS.COOPTIMUS_PROSE_ENABLED,
      enabled ? 'true' : 'false',
    );
}
