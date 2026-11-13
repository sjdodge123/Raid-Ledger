/**
 * ROK-2187 lane 7 — the share card renders ONLY the public Summary allow-list
 * (AC8, Q4): extra keys on the input never reach the satori tree, and the
 * rasteriser draws real glyphs with the bundled font (F6 — no fontconfig).
 */
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
import type { GgPublicSummaryDto } from '@raid-ledger/contract';
import {
  buildGgShareCardTree,
  ggNode,
  ggShareCardModel,
  ggShareCountsLine,
} from './gg-share-card.template';
import { rasterizeGgTree, renderGgShareCardPng } from './gg-share-card.render';

const DTO: GgPublicSummaryDto = {
  year: 2026,
  displayName: 'Thrall',
  avatarUrl: null,
  eventsAttended: 42,
  hoursPlayedSeconds: 380 * 3600,
  topGames: [
    { name: 'World of Warcraft', coverUrl: null },
    { name: 'Valheim', coverUrl: null },
    { name: 'Baldur’s Gate 3', coverUrl: null },
  ],
  playedWithCount: 17,
  superlative: 'night-owl',
};

/** A DTO carrying keys the public card must never render. */
function leakyDto(): GgPublicSummaryDto {
  const extra = {
    ...DTO,
    email: 'leak@example.com',
    discordId: '123456789012345678',
    coPlayerNames: ['Jaina Proudmoore'],
  };
  return extra;
}

/** Pixel min/max spread across all channels of a PNG. */
async function channelSpread(png: Buffer): Promise<number> {
  const { channels } = await sharp(png).stats();
  return Math.max(...channels.map((c) => c.max - c.min));
}

describe('ggShareCardModel / buildGgShareCardTree', () => {
  it('keeps the allow-list fields and drops everything else', () => {
    const tree = JSON.stringify(buildGgShareCardTree(leakyDto()));
    expect(tree).toContain('Thrall');
    expect(tree).toContain('GG 2026');
    expect(tree).toContain('42');
    expect(tree).toContain('380h');
    expect(tree).toContain('17');
    expect(tree).toContain('Valheim');
    expect(tree).toContain('The Night Owl');
    for (const leak of ['leak@example.com', '123456789012345678', 'Jaina']) {
      expect(tree).not.toContain(leak);
    }
  });

  it('projects exactly the public fields into the model', () => {
    const model = ggShareCardModel(leakyDto());
    expect(Object.keys(model).sort()).toEqual([
      'displayName',
      'stats',
      'superlativeTitle',
      'topGames',
      'year',
    ]);
    expect(model.stats).toEqual([
      { value: '42', label: 'events attended' },
      { value: '380h', label: 'hours played' },
      { value: '17', label: 'people played with' },
    ]);
  });

  it('omits the superlative line when there is none', () => {
    const tree = JSON.stringify(
      buildGgShareCardTree({ ...DTO, superlative: null }),
    );
    expect(tree).not.toContain('The Night Owl');
  });
});

describe('rasterizeGgTree / renderGgShareCardPng', () => {
  it('draws glyphs: a lone string on a flat background is not a blank PNG', async () => {
    const flat = {
      display: 'flex',
      width: '100%',
      height: '100%',
      background: '#000000',
      color: '#ffffff',
      fontSize: 48,
    };
    const tree = ggNode('div', flat, 'GG');
    const png = await rasterizeGgTree(tree, 200, 100);
    expect(await channelSpread(png)).toBeGreaterThan(100);
  });

  it('renders a 1200x630 PNG for the OG card', async () => {
    const png = await renderGgShareCardPng(DTO);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const meta = await sharp(png).metadata();
    expect({ w: meta.width, h: meta.height, f: meta.format }).toEqual({
      w: 1200,
      h: 630,
      f: 'png',
    });
    const samplePath = process.env.GG_SHARE_SAMPLE_PATH;
    if (samplePath) writeFileSync(samplePath, png);
  });
});

describe('share card — no zero values, singular counts (ROK-2187)', () => {
  it('drops every zero stat from the card and the og line', () => {
    const dto = { ...DTO, eventsAttended: 0, hoursPlayedSeconds: 600 };
    expect(ggShareCardModel(dto).stats.map((s) => s.label)).toEqual([
      'people played with',
    ]);
    const tree = JSON.stringify(buildGgShareCardTree(dto));
    expect(tree).not.toContain('events attended');
    expect(tree).not.toContain('hours played');
    expect(ggShareCountsLine(dto)).toBe('played with 17 people');
  });

  it('uses singular labels for counts of one', () => {
    const dto = {
      ...DTO,
      eventsAttended: 1,
      hoursPlayedSeconds: 3600,
      playedWithCount: 1,
    };
    expect(ggShareCardModel(dto).stats).toEqual([
      { value: '1', label: 'event attended' },
      { value: '1h', label: 'hour played' },
      { value: '1', label: 'person played with' },
    ]);
    expect(ggShareCountsLine(dto)).toBe(
      '1 event · 1h played · played with 1 person',
    );
  });

  it('keeps the plural line for larger counts', () => {
    expect(ggShareCountsLine(DTO)).toBe(
      '42 events · 380h played · played with 17 people',
    );
  });
});

describe('share card — a GG with no counted stats (voice/hubs-only)', () => {
  const EMPTY: GgPublicSummaryDto = {
    ...DTO,
    eventsAttended: 0,
    hoursPlayedSeconds: 0,
    playedWithCount: 0,
  };

  it('never leaves og:description empty: superlative + year', () => {
    expect(ggShareCountsLine(EMPTY)).toBe('The Night Owl · GG 2026');
  });

  it('falls back to the year alone without a superlative', () => {
    expect(ggShareCountsLine({ ...EMPTY, superlative: null })).toBe(
      'A year in games with the community · GG 2026',
    );
  });

  it('draws a fallback line instead of an empty stats row', () => {
    const tree = JSON.stringify(buildGgShareCardTree(EMPTY));
    expect(ggShareCardModel(EMPTY).stats).toEqual([]);
    expect(tree).toContain('A year in games with the community');
  });

  it('does not add the fallback line when there are stats', () => {
    const tree = JSON.stringify(buildGgShareCardTree(DTO));
    expect(tree).not.toContain('A year in games with the community');
  });
});
