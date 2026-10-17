/**
 * The listener's `onBotConnected` recovery run (ROK-1801: extracted so the
 * listener stays under the 300-line cap after gaining its CHANGED handler).
 * Step order and per-step guarding live in `voice-state-connect.helpers.ts`.
 */
import {
  connectRecoverySteps,
  runConnectRecoverySteps,
} from './voice-state-connect.helpers';
import {
  handleChannelJoin,
  type JoinHandlerCtx,
} from './voice-state-join-dispatch.handlers';

export interface BotConnectHooks {
  reportBindingHealth: () => Promise<void>;
  startCacheSweep: () => void;
}

/** Run the connect-recovery chain with the listener's join context. */
export function runBotConnectRecovery(
  ctx: JoinHandlerCtx,
  hooks: BotConnectHooks,
): Promise<void> {
  const steps = connectRecoverySteps({
    deps: ctx.deps,
    reportBindingHealth: hooks.reportBindingHealth,
    resolveBinding: async (ch) => (await ctx.resolveAllBindings(ch))[0] ?? null,
    handleJoin: (ch, dm, gm) => handleChannelJoin(ctx, ch, dm, gm),
    startCacheSweep: hooks.startCacheSweep,
  });
  return runConnectRecoverySteps(steps, ctx.logger);
}
