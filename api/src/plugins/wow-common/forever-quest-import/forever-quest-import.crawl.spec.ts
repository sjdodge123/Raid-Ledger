/**
 * ROK-2143 review m2/m3 — the crawl spaces every request after the first by
 * FOREVER_QUEST_IMPORT_SPACING_MS, and checks the kill switch before each one
 * (so flipping it mid-run stops the crawl at the next request).
 */
import {
  CLASSIC_QUEST_AREAS,
  classicQuestAreaInstanceIds,
} from './classic-quest-areas';
import { FOREVER_QUEST_IMPORT_OFF_MESSAGE } from './forever-quest-import-switch';
import {
  QUEST_IMPORT_NO_AREAS_MESSAGE,
  QuestImportCrawl,
  questImportNoMappedAreasMessage,
  type QuestImportDeps,
  type QuestImportResponse,
} from './forever-quest-import.crawl';
import {
  FOREVER_QUEST_IMPORT_SPACING_MS,
  QuestImportAbort,
  emptyQuestImportReport,
} from './forever-quest-import.report';

/** Every mapped area as a Blizzard `{ id, name }` area entry. */
function mappedAreas(): { id: number; name: string }[] {
  return classicQuestAreaInstanceIds().flatMap((id) => {
    const entry = CLASSIC_QUEST_AREAS[id];
    if (!entry) return [];
    return [{ id: entry.areaId, name: entry.areaNames[0] ?? entry.dungeon }];
  });
}

/** An index naming every mapped area, so each one is requested (and 404s). */
function indexBody(): unknown {
  return { areas: mappedAreas() };
}

/** Deps whose calls land in `log` in order: `pause:<ms>` / `fetch`. */
function deps(log: string[], enabled: () => boolean): QuestImportDeps {
  const index = indexBody();
  return {
    region: 'us',
    runId: 'run-1',
    knownQuests: new Map(),
    fetchJson: (url) => {
      log.push('fetch');
      return Promise.resolve(
        url.includes('quest/index')
          ? { status: 200, body: index }
          : { status: 404, body: null },
      );
    },
    pause: (ms) => {
      log.push(`pause:${ms}`);
      return Promise.resolve();
    },
    isEnabled: () => Promise.resolve(enabled()),
    saveQuest: () => Promise.resolve(),
  };
}

describe('QuestImportCrawl — request spacing (AC2)', () => {
  it('pauses SPACING_MS before every request but the first', async () => {
    const log: string[] = [];
    const report = emptyQuestImportReport();
    await new QuestImportCrawl(
      deps(log, () => true),
      report,
    ).run();
    const fetches = log.filter((e) => e === 'fetch').length;
    expect(fetches).toBeGreaterThan(2);
    expect(report.counts.requests).toBe(fetches);
    expect(log[0]).toBe('fetch');
    const expected = Array.from({ length: fetches }, (_, i) =>
      i === 0
        ? ['fetch']
        : [`pause:${FOREVER_QUEST_IMPORT_SPACING_MS}`, 'fetch'],
    ).flat();
    expect(log).toEqual(expected);
  });
});

describe('QuestImportCrawl — kill switch before each request', () => {
  it('stops at the next request once the switch flips off mid-run', async () => {
    const log: string[] = [];
    const report = emptyQuestImportReport();
    let checks = 0;
    const crawl = new QuestImportCrawl(
      deps(log, () => {
        checks += 1;
        return checks <= 2;
      }),
      report,
    );
    const err: unknown = await crawl.run().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(QuestImportAbort);
    expect(err instanceof Error ? err.message : err).toBe(
      FOREVER_QUEST_IMPORT_OFF_MESSAGE,
    );
    expect(report.counts.requests).toBe(2);
    expect(log.filter((e) => e === 'fetch')).toHaveLength(2);
  });
});

const BLIZZ = 'https://us.api.blizzard.com/data/wow/';
const link = (path: string) => ({
  href: `${BLIZZ}${path}?namespace=static-forever-us`,
});
/** Blizzard's documented `quest/index`: links to its lists, no inline areas. */
const LINKED_INDEX = {
  _links: { self: link('quest/index') },
  categories: link('quest/category/index'),
  areas: link('quest/area/index'),
  types: link('quest/type/index'),
};
const MAPPED = classicQuestAreaInstanceIds().length;

/** Deps answering by URL path; every fetched URL lands in `urls`. */
function routed(
  urls: string[],
  route: (path: string) => QuestImportResponse,
): QuestImportDeps {
  return {
    region: 'us',
    runId: 'run-1',
    knownQuests: new Map(),
    fetchJson: (url) => {
      urls.push(url);
      const path = url.startsWith(BLIZZ) ? url.slice(BLIZZ.length) : url;
      return Promise.resolve(route(path.split('?')[0] ?? ''));
    },
    pause: () => Promise.resolve(),
    isEnabled: () => Promise.resolve(true),
    saveQuest: () => Promise.resolve(),
  };
}

const ok = (body: unknown): QuestImportResponse => ({ status: 200, body });
const NOT_FOUND: QuestImportResponse = { status: 404, body: null };

async function runCrawl(deps: QuestImportDeps) {
  const report = emptyQuestImportReport();
  const err: unknown = await new QuestImportCrawl(deps, report).run().then(
    () => null,
    (e: unknown) => e,
  );
  return { report, err };
}

describe('QuestImportCrawl — area list source (L5: quest/index only links)', () => {
  it('reads quest/area/index when quest/index has areas: { href }', async () => {
    const urls: string[] = [];
    const listed = mappedAreas();
    const { report, err } = await runCrawl(
      routed(urls, (path) => {
        if (path === 'quest/index') return ok(LINKED_INDEX);
        if (path === 'quest/area/index')
          return ok({ _links: {}, areas: listed });
        if (path.startsWith('quest/area/')) return ok({ quests: [] });
        return NOT_FOUND;
      }),
    );
    expect(err).toBeNull();
    expect(report.mismatchedAreas).toEqual([]);
    expect(report.counts.areasImported).toBe(MAPPED);
    expect(urls.filter((u) => u.includes('/quest/area/index?'))).toEqual([
      `${BLIZZ}quest/area/index?namespace=static-forever-us&locale=en_US`,
    ]);
    expect(urls.every((u) => u.startsWith(BLIZZ))).toBe(true);
    expect(urls.every((u) => u.includes('namespace=static-forever-us'))).toBe(
      true,
    );
  });

  it('uses an inline quest/index areas[] without requesting quest/area/index', async () => {
    const urls: string[] = [];
    const { err } = await runCrawl(
      routed(urls, (path) =>
        path === 'quest/index' ? ok(indexBody()) : NOT_FOUND,
      ),
    );
    expect(err).toBeNull();
    expect(urls.some((u) => u.includes('/quest/area/index?'))).toBe(false);
  });
});

describe('QuestImportCrawl — a run that finds no areas fails', () => {
  it('fails when neither index lists an area', async () => {
    const urls: string[] = [];
    const { report, err } = await runCrawl(
      routed(urls, (path) => {
        if (path === 'quest/index') return ok(LINKED_INDEX);
        if (path === 'quest/area/index') return ok({ _links: {}, areas: [] });
        return NOT_FOUND;
      }),
    );
    expect(err).toBeInstanceOf(QuestImportAbort);
    expect(err instanceof Error ? err.message : err).toBe(
      QUEST_IMPORT_NO_AREAS_MESSAGE,
    );
    expect(report.counts.requests).toBe(2);
  });

  it('fails when quest/area/index has no data', async () => {
    const urls: string[] = [];
    const { err } = await runCrawl(
      routed(urls, (path) =>
        path === 'quest/index' ? ok(LINKED_INDEX) : NOT_FOUND,
      ),
    );
    expect(err).toBeInstanceOf(QuestImportAbort);
    expect(err instanceof Error ? err.message : err).toBe(
      'quest/area/index: no data',
    );
  });

  it('fails, keeping mismatchedAreas, when no mapped area is in the list', async () => {
    const urls: string[] = [];
    const { report, err } = await runCrawl(
      routed(urls, (path) => {
        if (path === 'quest/index') return ok(LINKED_INDEX);
        if (path === 'quest/area/index') {
          return ok({
            _links: {},
            areas: [
              { key: link('quest/area/12'), name: 'Elwynn Forest', id: 12 },
            ],
          });
        }
        return NOT_FOUND;
      }),
    );
    expect(err).toBeInstanceOf(QuestImportAbort);
    expect(err instanceof Error ? err.message : err).toBe(
      questImportNoMappedAreasMessage(MAPPED),
    );
    expect(report.mismatchedAreas).toHaveLength(MAPPED);
    expect(urls.some((u) => /quest\/area\/\d+\?/.test(u))).toBe(false);
  });
});

const KRAUL = 234;
const kraulEntry = CLASSIC_QUEST_AREAS[KRAUL];
if (!kraulEntry) throw new Error('missing area entry: Razorfen Kraul (234)');
const kraulAreaId = kraulEntry.areaId;
/** Every mapped area but Razorfen Kraul, plus a same-named area 4000. */
const listed = [
  ...mappedAreas().filter((a) => a.id !== kraulAreaId),
  { id: 4000, name: 'Razorfen Kraul' },
];

function route(path: string): QuestImportResponse {
  if (path === 'quest/index') return ok(LINKED_INDEX);
  if (path === 'quest/area/index') return ok({ _links: {}, areas: listed });
  if (path === 'quest/1101') {
    return ok({
      id: 1101,
      title: 'The Crone of the Kraul',
      area: { id: 17, name: 'The Barrens' },
    });
  }
  if (path.startsWith('quest/area/')) return ok({ quests: [] });
  return NOT_FOUND;
}

describe('QuestImportCrawl — mismatch evidence (L6)', () => {
  it('reports the name-alike area and the area a sample quest is filed under', async () => {
    const urls: string[] = [];
    const saved: number[] = [];
    const { report, err } = await runCrawl({
      ...routed(urls, route),
      knownQuests: new Map([
        [1144, KRAUL],
        [1101, KRAUL],
      ]),
      saveQuest: (row) => {
        saved.push(row.questId);
        return Promise.resolve();
      },
    });
    expect(err).toBeNull();
    expect(report.mismatchedAreas).toEqual([
      {
        instanceId: KRAUL,
        dungeon: 'Razorfen Kraul',
        areaId: kraulAreaId,
        actualName: null,
        nameMatches: [{ id: 4000, name: 'Razorfen Kraul' }],
        sampleQuest: {
          questId: 1101,
          httpStatus: 200,
          areaId: 17,
          areaName: 'The Barrens',
        },
      },
    ]);
    expect(saved).toEqual([]);
    expect(urls.some((u) => u.includes('/quest/area/4000?'))).toBe(false);
  });

  it('omits the evidence fields when there is none', async () => {
    const { report } = await runCrawl(
      routed([], (path) =>
        path === 'quest/area/index' || path === 'quest/index'
          ? ok({ areas: mappedAreas().filter((a) => a.id !== kraulAreaId) })
          : ok({ quests: [] }),
      ),
    );
    expect(report.mismatchedAreas).toEqual([
      {
        instanceId: KRAUL,
        dungeon: 'Razorfen Kraul',
        areaId: kraulAreaId,
        actualName: null,
      },
    ]);
  });
});

describe('QuestImportCrawl — error lines (L6)', () => {
  it('keeps a non-fatal quest miss as a readable error line naming the quest', async () => {
    const stockade = 238;
    const { report, err } = await runCrawl({
      ...routed([], route),
      knownQuests: new Map([[99999, stockade]]),
    });
    expect(err).toBeNull();
    expect(report.status).toBe('idle');
    expect(report.errors).toEqual(['quest/99999: HTTP 404']);
    expect(report.unlistedQuests).toEqual([]);
  });
});

/** Kraul's sample quest 1101 answers with `answer`; everything else routes. */
function probeDeps(answer: () => Promise<QuestImportResponse>) {
  const base = routed([], route);
  const deps: QuestImportDeps = {
    ...base,
    knownQuests: new Map([[1101, KRAUL]]),
    fetchJson: (url) =>
      url.includes('/quest/1101?') ? answer() : base.fetchJson(url),
  };
  return deps;
}

describe('QuestImportCrawl — the sample-quest probe is evidence only (M1)', () => {
  it.each([404, 503, 500, 401])(
    'records HTTP %i on the skipped area and finishes the run',
    async (status) => {
      const { report, err } = await runCrawl(
        probeDeps(() => Promise.resolve({ status, body: null })),
      );
      expect(err).toBeNull();
      expect(report.mismatchedAreas[0]?.sampleQuest).toEqual({
        questId: 1101,
        httpStatus: status,
        areaId: null,
        areaName: null,
      });
      expect(report.counts.areasImported).toBe(MAPPED - 1);
    },
  );

  it('records a thrown request as HTTP 0 plus an error line and finishes the run', async () => {
    const { report, err } = await runCrawl(
      probeDeps(() => Promise.reject(new Error('socket hang up'))),
    );
    expect(err).toBeNull();
    expect(report.mismatchedAreas[0]?.sampleQuest).toEqual({
      questId: 1101,
      httpStatus: 0,
      areaId: null,
      areaName: null,
    });
    expect(report.errors).toContain('quest/1101: socket hang up');
    expect(report.counts.areasImported).toBe(MAPPED - 1);
  });
});

/** Kraul's sample quest routed normally; the switch answers `enabled()`. */
function switchDeps(urls: string[], enabled: () => boolean): QuestImportDeps {
  return {
    ...routed(urls, route),
    knownQuests: new Map([[1101, KRAUL]]),
    isEnabled: () => Promise.resolve(enabled()),
  };
}

describe('QuestImportCrawl — the kill switch still stops the run at the probe (r4 MINOR 2)', () => {
  it('aborts with the OFF message when the switch is off exactly at the sample probe', async () => {
    const firstPass: string[] = [];
    await runCrawl(switchDeps(firstPass, () => true));
    const probeAt = firstPass.findIndex((u) => u.includes('/quest/1101?'));
    expect(probeAt).toBeGreaterThan(0);

    let checks = 0;
    const urls: string[] = [];
    const { report, err } = await runCrawl(
      switchDeps(urls, () => {
        checks += 1;
        return checks !== probeAt + 1;
      }),
    );
    expect(err).toBeInstanceOf(QuestImportAbort);
    expect(err instanceof Error ? err.message : err).toBe(
      FOREVER_QUEST_IMPORT_OFF_MESSAGE,
    );
    expect(urls.some((u) => u.includes('/quest/1101?'))).toBe(false);
    expect(report.errors.filter((e) => e.startsWith('quest/1101'))).toEqual([]);
    expect(report.counts.requests).toBe(probeAt);
  });
});
