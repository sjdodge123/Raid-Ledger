/**
 * ROK-1767 — the cron's tracked outcome. A run where any game failed must not
 * be recorded as a clean success in cron history.
 */
import type { GameRoleRunResultDto } from '@raid-ledger/contract';
import type { CronJobService } from '../../cron-jobs/cron-job.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { GameRoleReconcileService } from './game-role-reconcile.service';
import type { GameRoleDb } from './game-role-reconcile.helpers';

type Outcome = void | boolean | { degraded: true };

async function trackedOutcome(
  result: GameRoleRunResultDto | false,
): Promise<Outcome> {
  let outcome: Outcome = undefined;
  const cron = {
    executeWithTracking: jest.fn(
      async (_name: string, fn: () => Promise<Outcome>) => {
        outcome = await fn();
      },
    ),
  } as unknown as CronJobService;
  const svc = new GameRoleReconcileService(
    {} as GameRoleDb,
    cron,
    {} as DiscordBotClientService,
  );
  jest.spyOn(svc, 'runReconciliation').mockResolvedValue(result);
  await svc.reconcileCron();
  return outcome;
}

const clean: GameRoleRunResultDto = {
  added: 2,
  removed: 1,
  skippedOverCap: 0,
  failedGames: [],
};

describe('GameRoleReconcileService.reconcileCron tracking', () => {
  it('records a run with failed games as degraded, not completed', async () => {
    await expect(
      trackedOutcome({ ...clean, failedGames: [7] }),
    ).resolves.toEqual({ degraded: true });
  });

  it('records a clean run as completed', async () => {
    await expect(trackedOutcome(clean)).resolves.toBeUndefined();
  });

  it('records a bot-offline skip as a no-op', async () => {
    await expect(trackedOutcome(false)).resolves.toBe(false);
  });
});

/** ROK-2261: the role follows the game the session was credited to. */
describe('GameRoleReconcileService.grantForOpens', () => {
  const FOREVER = 11;
  const ANNIV = 22;
  const CLASSIC = 'World of Warcraft Classic';

  async function grantsFor(
    opens: Parameters<GameRoleReconcileService['grantForOpens']>[0],
  ): Promise<unknown[][]> {
    const svc = new GameRoleReconcileService(
      {} as GameRoleDb,
      {} as CronJobService,
      {} as DiscordBotClientService,
    );
    const grant = jest.spyOn(svc, 'grantNow').mockResolvedValue(true);
    svc.grantForOpens(opens, new Map([[CLASSIC, ANNIV]]));
    // grantForOpens is fire-and-forget: let its sequential grants settle.
    await new Promise((resolve) => setImmediate(resolve));
    return grant.mock.calls;
  }

  it('grants the attributed game, never the name-resolved one', async () => {
    const calls = await grantsFor([
      { userId: 1, discordActivityName: CLASSIC, attributedGameId: FOREVER },
    ]);
    expect(calls).toEqual([[1, FOREVER]]);
  });

  it('grants nothing when the attribution withheld the credit', async () => {
    const calls = await grantsFor([
      { userId: 1, discordActivityName: CLASSIC, attributedGameId: null },
    ]);
    expect(calls).toEqual([]);
  });

  it('falls back to the name-resolved game when nothing was attributed', async () => {
    const calls = await grantsFor([
      { userId: 2, discordActivityName: CLASSIC },
    ]);
    expect(calls).toEqual([[2, ANNIV]]);
  });
});
