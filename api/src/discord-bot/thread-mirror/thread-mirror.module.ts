/**
 * ROK-1483 — wiring for the read-only thread mirror.
 *
 * A module of its own rather than providers inside `DiscordBotModule`: the
 * mirror owns an HTTP controller and a database table, and folding it into the
 * bot module would add a third edge to a module that already carries a
 * `forwardRef`. `DiscordBotModule` is imported for the client service the
 * backfill needs; nothing here is imported back by the bot.
 *
 * Registered in `app.module.ts` next to `LfgBoardModule`.
 */
import { Module, type OnModuleInit } from '@nestjs/common';
import { DrizzleModule } from '../../drizzle/drizzle.module';
import { DiscordBotModule } from '../discord-bot.module';
import { DiscordThreadsController } from './discord-threads.controller';
import { LfgGroupSurfaceResolver } from './lfg-group-surface.resolver';
import { ThreadMirrorListener } from './thread-mirror.listener';
import { ThreadMirrorService } from './thread-mirror.service';
import { ThreadSurfaceRegistry } from './thread-surface.registry';

@Module({
  imports: [DrizzleModule, DiscordBotModule],
  controllers: [DiscordThreadsController],
  providers: [
    ThreadSurfaceRegistry,
    LfgGroupSurfaceResolver,
    ThreadMirrorService,
    ThreadMirrorListener,
  ],
  exports: [ThreadMirrorService, ThreadSurfaceRegistry],
})
export class ThreadMirrorModule implements OnModuleInit {
  constructor(
    private readonly registry: ThreadSurfaceRegistry,
    private readonly lfgGroups: LfgGroupSurfaceResolver,
  ) {}

  /**
   * Register the v1 surface. There is no auto-discovery on purpose — the
   * registry denies an unregistered kind rather than throwing, so a resolver
   * that is never registered fails as a 403 rather than as a crash, and that
   * is much easier to miss than one explicit line here.
   *
   * ROK-1484 adds one resolver file and one line below.
   */
  onModuleInit(): void {
    this.registry.register('lfg-group', this.lfgGroups);
  }
}
