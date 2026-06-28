import {
  getEphemeralVoiceEnabled as _getEphemeralVoiceEnabled,
  setEphemeralVoiceEnabled as _setEphemeralVoiceEnabled,
  getEphemeralVoiceForced as _getEphemeralVoiceForced,
  setEphemeralVoiceForced as _setEphemeralVoiceForced,
  getEphemeralVoiceCategoryId as _getEphemeralVoiceCategoryId,
  setEphemeralVoiceCategoryId as _setEphemeralVoiceCategoryId,
  getEphemeralVoiceCreateBufferMinutes as _getEphemeralVoiceCreateBufferMinutes,
  setEphemeralVoiceCreateBufferMinutes as _setEphemeralVoiceCreateBufferMinutes,
  getEphemeralVoiceIdleMinutes as _getEphemeralVoiceIdleMinutes,
  setEphemeralVoiceIdleMinutes as _setEphemeralVoiceIdleMinutes,
} from './settings-discord.helpers';
import type { SettingsCore } from './settings-bot.helpers';

/**
 * ROK-1352: ephemeral-voice settings delegations, extracted from SettingsService
 * so that file stays under the STRICT 300-line cap. SettingsService extends this;
 * at runtime `this` is the concrete service, which satisfies SettingsCore (get/set),
 * the shape the underlying helpers require.
 */
export abstract class EphemeralVoiceSettingsBase {
  private get core(): SettingsCore {
    return this as unknown as SettingsCore;
  }

  /** Master toggle for ephemeral voice channels. */
  getEphemeralVoiceEnabled = () => _getEphemeralVoiceEnabled(this.core);
  setEphemeralVoiceEnabled = (enabled: boolean) =>
    _setEphemeralVoiceEnabled(this.core, enabled);
  /** Force-ephemeral: always create a channel for every managed event. */
  getEphemeralVoiceForced = () => _getEphemeralVoiceForced(this.core);
  setEphemeralVoiceForced = (forced: boolean) =>
    _setEphemeralVoiceForced(this.core, forced);
  /** Parent category ID for ephemeral channels (null = guild root). */
  getEphemeralVoiceCategoryId = () => _getEphemeralVoiceCategoryId(this.core);
  setEphemeralVoiceCategoryId = (id: string | null) =>
    _setEphemeralVoiceCategoryId(this.core, id);
  /** Minutes before start to create the channel (default 30). */
  getEphemeralVoiceCreateBufferMinutes = () =>
    _getEphemeralVoiceCreateBufferMinutes(this.core);
  setEphemeralVoiceCreateBufferMinutes = (m: number) =>
    _setEphemeralVoiceCreateBufferMinutes(this.core, m);
  /** Minutes empty post-event before delete (default 30). */
  getEphemeralVoiceIdleMinutes = () => _getEphemeralVoiceIdleMinutes(this.core);
  setEphemeralVoiceIdleMinutes = (m: number) =>
    _setEphemeralVoiceIdleMinutes(this.core, m);
}
