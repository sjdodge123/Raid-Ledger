import sharp from 'sharp';

/** A solid-colour PNG of the given size (spec + demo-seed fixture). */
export function solidPng(
  width: number,
  height: number,
  hue = 0,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: (hue * 37) % 256, g: (hue * 91) % 256, b: 160 },
    },
  })
    .png()
    .toBuffer();
}
