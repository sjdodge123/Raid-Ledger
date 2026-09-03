// ROK-1469 D2 — rl_status envs[] carries the per-slot Discord bot identity.
//
// Every fleet env now runs as ITS SLOT's Discord app. An agent debugging
// "why did my embed land in the other env" needs to see WHICH app an env is
// posting as, so `status`'s envs[] gained `bot_identity`. It carries the
// PUBLIC client id + app name only — the token and client secret never leave
// /srv/rl-infra/.env, so a leak here would be a real incident, and the last
// test pins that.
//
// Optional + nullable throughout so an orchestrator that predates ROK-1469
// (no bot_identity key at all) still parses.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import { execute, type BotIdentity, type StatusResult } from '../status.js';

function execFileOk(stdout: string): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, '');
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

const ENV_ROW = {
  container: 'rl-env-demo-allinone',
  slug: 'demo',
  slot: '2',
  ttl: '24h',
  last_touched: '2026-09-02T00:00:00Z',
  status: 'Up 3 minutes',
  created: '2026-09-02 00:00:00 +0000 UTC',
};

const BASE = {
  ok: true,
  generated_at: '2026-09-02T00:10:00Z',
  slots: [],
  runners: [],
  host: { memory: '8G/16G', disk: '50G/100G (50%)', loadavg: '0.5 0.6 0.7' },
  queue: [],
  queue_depth: 0,
  queue_head: null,
};

describe('rl_status — ROK-1469 per-slot bot identity', () => {
  it('passes bot_identity through on each env row', async () => {
    const identity: BotIdentity = {
      slot: 2,
      client_id: '200000000000000002',
      app_name: 'Raid Ledger Test Slot 2',
      configured: true,
    };
    execFileOk(
      JSON.stringify({ ...BASE, envs: [{ ...ENV_ROW, bot_identity: identity }] }),
    );
    const res: StatusResult = await execute();
    expect(res.ok).toBe(true);
    expect(res.envs?.[0].bot_identity).toEqual(identity);
  });

  it('accepts bot_identity:null for an env whose slot is unresolvable', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE,
        envs: [{ ...ENV_ROW, slot: null, bot_identity: null }],
      }),
    );
    const res = await execute();
    expect(res.envs?.[0].bot_identity).toBeNull();
  });

  it('accepts an env row with no bot_identity key (pre-ROK-1469 orchestrator)', async () => {
    execFileOk(JSON.stringify({ ...BASE, envs: [ENV_ROW] }));
    const res = await execute();
    expect(res.envs?.[0].slug).toBe('demo');
    expect(res.envs?.[0].bot_identity).toBeUndefined();
  });

  it('reports an unconfigured slot as configured:false with null ids', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE,
        envs: [
          {
            ...ENV_ROW,
            bot_identity: { slot: 4, client_id: null, app_name: null, configured: false },
          },
        ],
      }),
    );
    const res = await execute();
    expect(res.envs?.[0].bot_identity).toMatchObject({
      configured: false,
      client_id: null,
    });
  });

  it('never surfaces a token/secret field — the type has no slot for one', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE,
        envs: [
          {
            ...ENV_ROW,
            bot_identity: { slot: 2, client_id: '2', app_name: null, configured: true },
          },
        ],
      }),
    );
    const res = await execute();
    const keys = Object.keys(res.envs?.[0].bot_identity ?? {});
    expect(keys.sort()).toEqual(['app_name', 'client_id', 'configured', 'slot']);
    expect(JSON.stringify(res)).not.toMatch(/token|client_secret/i);
  });
});
