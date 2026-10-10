/**
 * ROK-1748: build `src/plugins/wow-common/data/forever-dungeon-quest-data.json`
 * from Wowhead Forever (dataEnv 16) zone + quest pages. Offline tool — the
 * app never fetches quest data at runtime.
 *
 *   cd api && npx ts-node scripts/prepare-forever-dungeon-quests.ts --fixtures <dir> [--out <file>]
 *   cd api && npx ts-node scripts/prepare-forever-dungeon-quests.ts --live [--max-requests 400]
 *
 * `--fixtures <dir>` reads `zone-<seedN>.html` (seedN = 1–11, see
 * `forever-instance-data.ts`) and `quest-<questId>.html`; no network.
 * `--live` fetches through the ROK-1727 limiter + UA (≤1 req/s, 3 tries,
 * redirects followed) with a hard request cap, and exits "zones not mapped"
 * while `FOREVER_WOWHEAD_ZONES` is all null.
 *
 * Refuses to run under jest/CI (`JEST_WORKER_ID` / `CI`). Specs may pass
 * `allowUnderTest: true` to `runPrepare` for `--fixtures` only; `--live`
 * is never allowed there.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildForeverQuestDataset,
  type BuildSummary,
  type QuestPageSource,
} from '../src/plugins/wow-common/forever-quest-import/forever-quest.build';
import {
  FOREVER_WOWHEAD_ZONES,
  unmappedZones,
} from '../src/plugins/wow-common/forever-quest-import/forever-quest.zones';
import { WOWHEAD_USER_AGENT } from '../src/plugins/wow-common/wowhead-item/wowhead-item.fetch';
import {
  WOWHEAD_MAX_TRIES_PER_RUN,
  createWowheadLimiter,
} from '../src/plugins/wow-common/wowhead-item/wowhead-item.limiter';

const DEFAULT_OUT = join(
  __dirname,
  '../src/plugins/wow-common/data/forever-dungeon-quest-data.json',
);
const WOWHEAD = 'https://www.wowhead.com/forever';

export interface PrepareOptions {
  env: NodeJS.ProcessEnv;
  /** Spec-only bypass of the jest/CI refusal; `--fixtures` mode only. */
  allowUnderTest?: boolean;
  log: (line: string) => void;
}

function argValue(argv: string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : undefined;
}

function fixtureSource(dir: string): QuestPageSource {
  const read = (file: string): Promise<string | null> => {
    const path = join(dir, file);
    return Promise.resolve(
      existsSync(path) ? readFileSync(path, 'utf-8') : null,
    );
  };
  return {
    zonePage: (n) => read(`zone-${n}.html`),
    questPage: (id) => read(`quest-${id}.html`),
  };
}

function liveSource(maxRequests: number): QuestPageSource {
  const limiter = createWowheadLimiter();
  let sent = 0;
  const get = async (url: string): Promise<string | null> => {
    for (let tryN = 1; tryN <= WOWHEAD_MAX_TRIES_PER_RUN; tryN++) {
      if (++sent > maxRequests)
        throw new Error(`request cap ${maxRequests} reached`);
      const res = await limiter.schedule(() =>
        fetch(url, {
          headers: { 'User-Agent': WOWHEAD_USER_AGENT },
          redirect: 'follow',
        }),
      );
      if (res.ok) return res.text();
      if (res.status === 404) return null;
    }
    return null;
  };
  return {
    zonePage: (n) => {
      const zoneId = FOREVER_WOWHEAD_ZONES[n];
      return zoneId ? get(`${WOWHEAD}/zone=${zoneId}`) : Promise.resolve(null);
    },
    questPage: (id) => get(`${WOWHEAD}/quest=${id}`),
  };
}

function printSummary(
  summary: BuildSummary,
  total: number,
  log: (l: string) => void,
): void {
  log(`rows: ${total}`);
  for (const [name, count] of Object.entries(summary.rowsPerInstance))
    log(`  ${name}: ${count}`);
  log(`null-instance pre-reqs: ${summary.nullInstancePrereqs}`);
  log(`notShown: ${summary.notShown.length} ${summary.notShown.join(',')}`);
  log(`skipped: ${summary.skipped.length}`);
  for (const s of summary.skipped) log(`  ${s.id ?? '-'}: ${s.reason}`);
  for (const line of summary.zoneReports) log(line);
}

function pickSource(
  argv: string[],
  opts: PrepareOptions,
): QuestPageSource | string {
  const live = argv.includes('--live');
  const dir = argValue(argv, '--fixtures');
  if (!live && !dir)
    return 'usage: --fixtures <dir> | --live [--max-requests N] [--out file]';
  const underTest = Boolean(opts.env.JEST_WORKER_ID || opts.env.CI);
  if (underTest && (live || !opts.allowUnderTest))
    return 'refusing to run under jest/CI';
  if (!live) return fixtureSource(dir as string);
  if (unmappedZones().length === Object.keys(FOREVER_WOWHEAD_ZONES).length)
    return 'zones not mapped';
  return liveSource(Number(argValue(argv, '--max-requests') ?? 400));
}

/** CLI entry; resolves the process exit code. */
export async function runPrepare(
  argv: string[],
  opts: PrepareOptions,
): Promise<number> {
  const source = pickSource(argv, opts);
  if (typeof source === 'string') {
    opts.log(source);
    return 1;
  }
  const { rows, summary } = await buildForeverQuestDataset(source);
  const out = argValue(argv, '--out') ?? DEFAULT_OUT;
  writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
  printSummary(summary, rows.length, opts.log);
  opts.log(`wrote ${out}`);
  return 0;
}

if (require.main === module) {
  void runPrepare(process.argv.slice(2), {
    env: process.env,
    log: (l) => console.log(l),
  }).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    },
  );
}
