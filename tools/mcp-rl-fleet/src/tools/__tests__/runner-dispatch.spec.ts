// The detached runner's tool dispatch: each tool reaches its own handler, and an
// unknown tool fails loudly instead of falling through to the deploy chain.
import { describe, it, expect, vi } from 'vitest';
import { dispatchTool } from '../runner-dispatch.js';

function handlers() {
  return {
    rl_env_deploy: vi.fn().mockResolvedValue(0),
    rl_env_clone_prod: vi.fn().mockResolvedValue(0),
    rl_env_spin: vi.fn().mockResolvedValue(0),
  };
}

describe('dispatchTool', () => {
  it('rl_env_spin runs the spin handler only', async () => {
    const h = handlers();
    const onUnknown = vi.fn();
    expect(await dispatchTool('rl_env_spin', h, onUnknown)).toBe(0);
    expect(h.rl_env_spin).toHaveBeenCalledTimes(1);
    expect(h.rl_env_deploy).not.toHaveBeenCalled();
    expect(h.rl_env_clone_prod).not.toHaveBeenCalled();
    expect(onUnknown).not.toHaveBeenCalled();
  });

  it.each(['rl_env_deploy', 'rl_env_clone_prod'] as const)('%s runs its own handler', async (tool) => {
    const h = handlers();
    await dispatchTool(tool, h, vi.fn());
    expect(h[tool]).toHaveBeenCalledTimes(1);
    expect(h.rl_env_spin).not.toHaveBeenCalled();
  });

  it('propagates the handler exit code', async () => {
    const h = handlers();
    h.rl_env_spin.mockResolvedValue(1);
    expect(await dispatchTool('rl_env_spin', h, vi.fn())).toBe(1);
  });

  it('an unknown tool fails as unknown_tool and never runs the deploy chain', async () => {
    const h = handlers();
    const onUnknown = vi.fn();
    expect(await dispatchTool('rl_env_bogus', h, onUnknown)).toBe(1);
    expect(onUnknown).toHaveBeenCalledWith({ error: 'unknown_tool', message: 'unknown tool rl_env_bogus' });
    expect(h.rl_env_deploy).not.toHaveBeenCalled();
    expect(h.rl_env_clone_prod).not.toHaveBeenCalled();
    expect(h.rl_env_spin).not.toHaveBeenCalled();
  });
});
