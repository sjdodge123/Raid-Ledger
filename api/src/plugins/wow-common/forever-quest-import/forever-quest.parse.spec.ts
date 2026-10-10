import { readFileSync } from 'fs';
import { join } from 'path';
import { FOREVER_SEED_ID_BASE } from '../forever-instance-data';
import {
  parseQuestPage,
  parseZoneQuestList,
  toDungeonQuestRow,
  type ParsedQuest,
  type ZoneQuestRow,
} from './forever-quest.parse';

const FIXTURES = join(__dirname, '../testing/fixtures/wowhead-quests');
const fixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), 'utf-8');

/** Wrap a quest Listview `data:` array the way Wowhead embeds it. */
function zoneHtml(data: string): string {
  return `<script>new Listview({template: 'quest', id: 'quests', name: WH.TERMS.quests, data: ${data}});</script>`;
}

describe('parseZoneQuestList', () => {
  it.each(['zone-1584-forever.html', 'zone-1584-classic.html'])(
    'parses the quest Listview in %s',
    (file) => {
      const list = parseZoneQuestList(fixture(file));
      expect(list.rows.length).toBeGreaterThanOrEqual(1);
      expect(list.skipped).toEqual([]);
      const ribbly = list.rows.find((r) => r.id === 4136);
      expect(ribbly).toMatchObject({
        name: 'Ribbly Screwspigot',
        level: 53,
        reqlevel: 48,
        side: 3,
        xp: 2650,
        money: 6000,
        itemchoices: [
          [11865, 1],
          [11963, 1],
          [12049, 1],
        ],
      });
    },
  );

  it('tolerates the Forever envChange key', () => {
    const list = parseZoneQuestList(fixture('zone-1584-forever.html'));
    expect(list.rows[0]).toHaveProperty('envChange');
  });

  it('reports notShown rows separately', () => {
    const list = parseZoneQuestList(
      zoneHtml(
        '[{"id":1,"name":"Shown"},{"id":2,"name":"Hidden","notShown":1},{"id":3,"name":"Empty","notShown":[]}]',
      ),
    );
    expect(list.rows.map((r) => r.id)).toEqual([1, 3]);
    expect(list.notShown.map((r) => r.id)).toEqual([2]);
  });

  it('skips and reports an off-shape row instead of throwing', () => {
    const list = parseZoneQuestList(
      zoneHtml('[{"id":5,"name":"Fine"},{"id":"x","name":7}]'),
    );
    expect(list.rows.map((r) => r.id)).toEqual([5]);
    expect(list.skipped).toHaveLength(1);
    expect(list.skipped[0]?.reason).toMatch(/zone row/);
  });

  it('reports a page without a quest Listview', () => {
    const list = parseZoneQuestList('<html></html>');
    expect(list.rows).toEqual([]);
    expect(list.skipped[0]?.reason).toMatch(/Listview not found/);
  });
});

describe('parseQuestPage', () => {
  it('reads the Forever quest 4136 infobox and series', () => {
    const parsed = parseQuestPage(fixture('quest-4136-forever.html'), {
      env: 'forever',
    });
    expect(parsed).toMatchObject({
      questLevel: 53,
      requiredLevel: 48,
      startNpcId: 9544,
      startNpcName: 'Yuka Screwspigot',
      side: 'Both',
      sharable: true,
      prevQuestId: 4324,
      nextQuestId: null,
    });
    expect(parsed?.series.map((s) => s.questId)).toEqual([4324, null]);
  });

  it('derives direct prev/next neighbours for chain quest 4001', () => {
    const parsed = parseQuestPage(fixture('quest-4001-classic.html'), {
      env: 'classic',
    });
    expect(parsed).toMatchObject({
      side: 'Horde',
      startNpcId: 9020,
      startNpcName: "Commander Gor'shak",
      prevQuestId: 3982,
      nextQuestId: 4002,
    });
    expect(parsed?.series).toHaveLength(6);
  });

  it('flags a series table that has rows but no bold current step', () => {
    const info = fixture('quest-4136-forever.html').match(
      /WH\.markup\.printHtml\("[\s\S]*?", "infobox-contents[^\n]*/,
    )?.[0];
    const series =
      '<table class="series"><tr><th>1.</th><td><div><a href="/forever/quest=10/a">A</a></div></td></tr>' +
      '<tr><th>2.</th><td><div>B</div></td></tr></table>';
    const result = parseQuestPage(`${info}\n${series}`, { env: 'forever' });
    expect(result).toMatchObject({
      seriesIssue: 'series-no-current',
      prevQuestId: null,
      nextQuestId: null,
    });
  });

  it('leaves seriesIssue null when the current step is bold', () => {
    const result = parseQuestPage(fixture('quest-4136-forever.html'), {
      env: 'forever',
    });
    expect(result?.seriesIssue).toBeNull();
  });

  it('returns null for a page with no infobox', () => {
    expect(parseQuestPage('<html></html>', { env: 'forever' })).toBeNull();
  });
});

const zoneRow = (): ZoneQuestRow =>
  parseZoneQuestList(fixture('zone-1584-forever.html')).rows.find(
    (r) => r.id === 4136,
  ) as ZoneQuestRow;
const parsed = (): ParsedQuest =>
  parseQuestPage(fixture('quest-4136-forever.html'), {
    env: 'forever',
  }) as ParsedQuest;

describe('toDungeonQuestRow', () => {
  it('builds a forever row keyed on the seed instance id', () => {
    const result = toDungeonQuestRow(zoneRow(), parsed(), 7);
    expect(result.ok && result.row).toMatchObject({
      questId: 4136,
      name: 'Ribbly Screwspigot',
      expansion: 'forever',
      dungeonInstanceId: FOREVER_SEED_ID_BASE + 7,
      questLevel: 53,
      requiredLevel: 48,
      questGiverNpc: 'Yuka Screwspigot',
      prevQuestId: 4324,
      nextQuestId: null,
      rewardsJson: [11865, 11963, 12049],
      rewardType: 'choice',
      rewardXp: 2650,
      rewardGold: 6000,
      sharable: true,
      startsInsideDungeon: false,
      raceRestriction: null,
    });
  });

  it('emits a null-instance row for a pre-req outside the zone set', () => {
    const result = toDungeonQuestRow(
      { id: 4324, name: 'Yuka' },
      parsed(),
      null,
    );
    expect(result.ok && result.row.dungeonInstanceId).toBeNull();
  });

  it('maps a Horde-only quest to the Horde race list', () => {
    const result = toDungeonQuestRow(
      { id: 9, name: 'H', side: 2 },
      parsed(),
      1,
    );
    expect(result.ok && result.row.raceRestriction).toEqual([
      'Orc',
      'Undead',
      'Tauren',
      'Troll',
    ]);
  });

  it('skips and reports an off-shape row', () => {
    const result = toDungeonQuestRow({ id: 10, name: '' }, parsed(), 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.skip).toMatchObject({ id: 10 });
    expect(result.skip.reason).toMatch(/row/);
  });
});
