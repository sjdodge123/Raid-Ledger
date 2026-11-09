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
  QuestImportCrawl,
  type QuestImportDeps,
} from './forever-quest-import.crawl';
import {
  FOREVER_QUEST_IMPORT_SPACING_MS,
  QuestImportAbort,
  emptyQuestImportReport,
} from './forever-quest-import.report';

/** An index naming every mapped area, so each one is requested (and 404s). */
function indexBody(): unknown {
  const areas = classicQuestAreaInstanceIds().flatMap((id) => {
    const entry = CLASSIC_QUEST_AREAS[id];
    if (!entry) return [];
    return [{ id: entry.areaId, name: entry.areaNames[0] ?? entry.dungeon }];
  });
  return { areas };
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
