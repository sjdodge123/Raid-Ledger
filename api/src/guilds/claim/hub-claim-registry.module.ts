/**
 * ROK-2362 #10 — `HubClaimRegistry` in its own module so the hub welcome
 * (`HubWelcomeModule`, which `GuildsCoreModule` imports) can read the claim
 * providers' welcome copy without importing `GuildsCoreModule` back.
 * `PluginRegistryService` is global (`PluginHostModule`).
 */
import { Module } from '@nestjs/common';
import { HubClaimRegistry } from './hub-claim.registry';

@Module({
  providers: [HubClaimRegistry],
  exports: [HubClaimRegistry],
})
export class HubClaimRegistryModule {}
