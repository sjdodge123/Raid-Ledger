import { Global, Module } from '@nestjs/common';
import { GgCardRegistry } from './gg-card.registry';
import { CoreGgCardRegistration } from './core-gg.registration';

/**
 * ROK-2187 — the GG card registry, global so each plugin module can inject
 * it and register its own cards without importing Core.
 */
@Global()
@Module({
  providers: [GgCardRegistry, CoreGgCardRegistration],
  exports: [GgCardRegistry],
})
export class GgCardModule {}
