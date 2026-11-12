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
    expect(Object.keys(ggShareCardModel(leakyDto())).sort()).toEqual([
      'displayName',
      'eventsAttended',
      'hours',
      'playedWithCount',
      'superlativeTitle',
      'topGames',
      'year',
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
