import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runPrepare } from '../../../../scripts/prepare-forever-dungeon-quests';
import { FOREVER_SEED_ID_BASE } from '../forever-instance-data';

const FIXTURES = join(__dirname, '../testing/fixtures/wowhead-quests');

/** Ribbly Screwspigot exactly as the captured Forever BRD Listview has it. */
const RIBBLY_ROW =
  '{"category":1584,"category2":2,"id":4136,"itemchoices":[[11865,1],[11963,1],[12049,1]],"level":53,"money":6000,"name":"Ribbly Screwspigot","reqlevel":48,"side":3,"type":81,"xp":2650,"envChange":{"status":"unchanged","labels":[],"lines":[]},"_type":1}';

/**
 * Seed n=7 (Alcaz Prison) lists only quest 4136, so its Series pre-req 4324
 * falls outside every zone set; n=8 gets the real BRD page (title mismatch).
 */
function makeFixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rok1748-'));
  writeFileSync(
    join(dir, 'zone-7.html'),
    `<title>Alcaz Prison - Zone - Forever</title><script>new Listview({template: 'quest', id: 'quests', data: [${RIBBLY_ROW}]});</script>`,
  );
  copyFileSync(
    join(FIXTURES, 'zone-1584-forever.html'),
    join(dir, 'zone-8.html'),
  );
  copyFileSync(
    join(FIXTURES, 'quest-4136-forever.html'),
    join(dir, 'quest-4136.html'),
  );
  copyFileSync(
    join(FIXTURES, 'quest-4001-classic.html'),
    join(dir, 'quest-4324.html'),
  );
  return dir;
}

function run(argv: string[], env: NodeJS.ProcessEnv, allowUnderTest = true) {
  const lines: string[] = [];
  const exit = runPrepare(argv, {
    env,
    allowUnderTest,
    log: (l) => lines.push(l),
  });
  return { exit, lines };
}

describe('prepare-forever-dungeon-quests (fixtures mode)', () => {
  it('writes rows sorted by questId and prints a summary', async () => {
    const dir = makeFixtureDir();
    const out = join(dir, 'out.json');
    const { exit, lines } = run(['--fixtures', dir, '--out', out], process.env);
    expect(await exit).toBe(0);
    const rows = JSON.parse(readFileSync(out, 'utf-8')) as Array<{
      questId: number;
      dungeonInstanceId: number | null;
    }>;
    expect(rows.map((r) => r.questId)).toEqual([4136, 4324]);
    expect(rows[0].dungeonInstanceId).toBe(FOREVER_SEED_ID_BASE + 7);
    expect(rows[1].dungeonInstanceId).toBeNull();
    const summary = lines.join('\n');
    expect(summary).toMatch(/Alcaz Prison: 1/);
    expect(summary).toMatch(/null-instance pre-reqs: 1/);
    expect(summary).toMatch(/zone 8 .*title/);
    expect(summary).toMatch(/skipped: \d+/);
  });

  it('refuses to run under jest without the explicit test bypass', async () => {
    const { exit, lines } = run(
      ['--fixtures', '/nonexistent'],
      { JEST_WORKER_ID: '1' },
      false,
    );
    expect(await exit).toBe(1);
    expect(lines.join('\n')).toMatch(/refusing/i);
  });

  it('never allows --live under test, even with the bypass', async () => {
    const { exit, lines } = run(['--live'], { CI: 'true' });
    expect(await exit).toBe(1);
    expect(lines.join('\n')).toMatch(/refusing/i);
  });

  it('rejects missing arguments with usage', async () => {
    const { exit, lines } = run([], process.env);
    expect(await exit).toBe(1);
    expect(lines.join('\n')).toMatch(/usage/i);
  });
});
