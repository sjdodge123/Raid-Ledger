import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildForeverQuestDataset,
  type QuestPageSource,
} from './forever-quest.build';

const FIXTURES = join(__dirname, '../testing/fixtures/wowhead-quests');
const QUEST_4136 = readFileSync(
  join(FIXTURES, 'quest-4136-forever.html'),
  'utf-8',
);
const RIBBLY_ROW =
  '{"id":4136,"level":53,"name":"Ribbly Screwspigot","reqlevel":48,"side":3}';

/** Seed 7 (Alcaz Prison, band 48–53) lists only quest 4136. */
function source(questHtml: string): QuestPageSource {
  return {
    zonePage: (n) =>
      Promise.resolve(
        n === 7
          ? `<title>Alcaz Prison - Zone</title><script>new Listview({template: 'quest', id: 'quests', data: [${RIBBLY_ROW}]});</script>`
          : null,
      ),
    questPage: (id) => Promise.resolve(id === 4136 ? questHtml : null),
  };
}

describe('buildForeverQuestDataset', () => {
  it('reports no outOfBand rows for an in-band quest', async () => {
    const { summary } = await buildForeverQuestDataset(source(QUEST_4136));
    expect(summary.outOfBand).toEqual([]);
  });

  it('reports (and still writes) a zone row >5 levels above the band max', async () => {
    const html = QUEST_4136.replace('Level: 53', 'Level: 59');
    const { rows, summary } = await buildForeverQuestDataset(source(html));
    expect(summary.outOfBand).toEqual([
      { questId: 4136, name: 'Ribbly Screwspigot', questLevel: 59, seedN: 7 },
    ]);
    expect(rows.map((r) => r.questId)).toContain(4136);
  });

  it('keeps a row exactly 5 levels above the band max in band', async () => {
    const html = QUEST_4136.replace('Level: 53', 'Level: 58');
    const { summary } = await buildForeverQuestDataset(source(html));
    expect(summary.outOfBand).toEqual([]);
  });

  it('reports a series table with no bold current step', async () => {
    const html = QUEST_4136.replace(
      /<div><b>([^<]+)<\/b><\/div>/,
      '<div>$1</div>',
    );
    const { summary } = await buildForeverQuestDataset(source(html));
    expect(summary.skipped).toContainEqual({
      id: 4136,
      reason: 'series-no-current',
    });
  });

  it('counts out-of-zone chain steps', async () => {
    const { summary } = await buildForeverQuestDataset(source(QUEST_4136));
    expect(summary.nullInstanceSteps).toBe(0);
  });
});
