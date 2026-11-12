/**
 * ROK-2187 lane 7 — rasterises a GG share card. satori lays out the tree and
 * turns every glyph into an SVG path using a bundled OFL font
 * (`@fontsource/inter`, .woff — satori cannot read woff2), then sharp
 * rasterises the SVG. No system font / fontconfig is needed, which matters
 * because the production image (node:22-alpine) installs none (spec F6).
 */
import { readFileSync } from 'node:fs';
import satori from 'satori';
import sharp from 'sharp';
import type { GgPublicSummaryDto } from '@raid-ledger/contract';
import {
  buildGgShareCardTree,
  GG_SHARE_CARD_SIZE,
  type GgCardNode,
} from './gg-share-card.template';

type FontWeight = 400 | 700 | 800;
interface LoadedFont {
  name: string;
  data: Buffer;
  weight: FontWeight;
  style: 'normal';
}

const WEIGHTS: readonly FontWeight[] = [400, 700, 800];
let fonts: LoadedFont[] | null = null;

/** Reads the Inter latin faces from node_modules once per process. */
function loadFonts(): LoadedFont[] {
  fonts ??= WEIGHTS.map((weight) => ({
    name: 'Inter',
    data: readFileSync(
      require.resolve(
        `@fontsource/inter/files/inter-latin-${weight}-normal.woff`,
      ),
    ),
    weight,
    style: 'normal',
  }));
  return fonts;
}

/** Lays out `tree` at `width`×`height` and returns PNG bytes. */
export async function rasterizeGgTree(
  tree: GgCardNode,
  width: number,
  height: number,
): Promise<Buffer> {
  const svg = await satori(tree, { width, height, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** The 1200×630 OG share card PNG for a public Summary DTO. */
export async function renderGgShareCardPng(
  dto: GgPublicSummaryDto,
): Promise<Buffer> {
  const { width, height } = GG_SHARE_CARD_SIZE;
  return rasterizeGgTree(buildGgShareCardTree(dto), width, height);
}
