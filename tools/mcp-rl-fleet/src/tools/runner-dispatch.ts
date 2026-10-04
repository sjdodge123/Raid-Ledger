// Tool dispatch for the detached laptop runner (runner-entry.ts).
//
// Kept out of runner-entry.ts so it is unit-testable: that module runs its
// chain at import time from process.argv. An unrecognised tool fails loudly —
// it never falls through to the deploy chain (a spin task must not run a full
// build + deploy).

export type RunnerTool = 'rl_env_deploy' | 'rl_env_clone_prod' | 'rl_env_spin';

export type RunnerHandlers = Record<RunnerTool, () => Promise<number>>;

/** Finalizes the task as failed with error `unknown_tool`. */
export type UnknownToolFn = (opts: { error: string; message: string }) => void;

export function isRunnerTool(tool: string): tool is RunnerTool {
  return tool === 'rl_env_deploy' || tool === 'rl_env_clone_prod' || tool === 'rl_env_spin';
}

/** Run the handler for `tool`; an unknown tool calls onUnknown and returns 1. */
export async function dispatchTool(
  tool: string,
  handlers: RunnerHandlers,
  onUnknown: UnknownToolFn,
): Promise<number> {
  if (isRunnerTool(tool)) return handlers[tool]();
  onUnknown({ error: 'unknown_tool', message: `unknown tool ${tool}` });
  return 1;
}
