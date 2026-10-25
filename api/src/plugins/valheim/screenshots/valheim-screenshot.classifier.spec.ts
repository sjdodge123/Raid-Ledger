/** ROK-1941 — the Valheim classifier's claim rule and first-image-only link. */
import { ValheimDeathLinkRepository } from './valheim-death-link.repository';
import { ValheimScreenshotClassifier } from './valheim-screenshot.classifier';
import { Test } from '@nestjs/testing';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type { HubMediaHubRef } from '../../../hub-media/hub-media-classifier.registry';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const HUB: HubMediaHubRef = {
  guildId: 1,
  pelicanServerId: 9,
  gameSlug: 'valheim',
};
const T = new Date('2026-10-20T12:00:00Z');
const text = (content: string) => ({
  id: '1',
  createdAt: T,
  content,
  embeds: [],
});

const links = { linkOrInferDeath: jest.fn() };
const plugins = { isActive: jest.fn() };
const db = { delete: jest.fn() };

async function build(): Promise<ValheimScreenshotClassifier> {
  jest.clearAllMocks();
  plugins.isActive.mockReturnValue(true);
  links.linkOrInferDeath.mockResolvedValue({
    outcome: 'inferred',
    deathId: 5,
    deltaSec: null,
  });
  const mod = await Test.createTestingModule({
    providers: [
      ValheimScreenshotClassifier,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: ValheimDeathLinkRepository, useValue: links },
      { provide: PluginRegistryService, useValue: plugins },
    ],
  }).compile();
  return mod.get(ValheimScreenshotClassifier);
}

describe('ValheimScreenshotClassifier', () => {
  let classifier: ValheimScreenshotClassifier;

  beforeEach(async () => {
    classifier = await build();
  });

  it('claims death and screenshot posts on a Valheim server hub', () => {
    expect(
      classifier.classify(text('Bjorn met their demise!'), HUB),
    ).toMatchObject({
      kind: 'death',
      authorName: 'Bjorn',
    });
    expect(
      classifier.classify(text('Astrid captured this screenshot!'), HUB),
    ).toMatchObject({
      kind: 'screenshot',
      authorName: 'Astrid',
    });
  });

  it.each([
    ['another game', { ...HUB, gameSlug: 'minecraft' }],
    ['no Pelican server', { ...HUB, pelicanServerId: null }],
  ])('leaves a death post on %s to the core default', (_l, hub) => {
    expect(
      classifier.classify(text('Bjorn met their demise!'), hub),
    ).toBeNull();
  });

  it('links only the first picture of a death post (D6), with the capture mm:ss', async () => {
    const ctx = {
      hub: HUB,
      post: text('Bjorn met their demise!'),
      classification: {
        kind: 'death' as const,
        authorName: 'Bjorn',
        caption: null,
      },
      mediaId: 42,
      filename: 'Bjorn_2026-10-20_12-03-07.png',
    };
    expect(await classifier.afterStore({ ...ctx, index: 1 })).toBeNull();
    expect(await classifier.afterStore({ ...ctx, index: 0 })).toBe('inferred');
    expect(links.linkOrInferDeath.mock.calls).toEqual([
      [
        {
          pelicanServerId: 9,
          characterName: 'Bjorn',
          postedAt: T,
          hubMediaId: 42,
          captureSecondOfHour: 187,
        },
      ],
    ]);
  });
});

describe('ValheimScreenshotClassifier with the Valheim plugin off (ROK-1969)', () => {
  it('claims nothing and links nothing', async () => {
    const classifier = await build();
    plugins.isActive.mockReturnValue(false);
    const death = text('Bjorn met their demise!');
    const ctx = {
      hub: HUB,
      post: death,
      classification: {
        kind: 'death' as const,
        authorName: 'Bjorn',
        caption: null,
      },
      mediaId: 42,
      index: 0,
      filename: null,
    };
    expect(classifier.classify(death, HUB)).toBeNull();
    expect(await classifier.afterStore(ctx)).toBeNull();
    expect(links.linkOrInferDeath).not.toHaveBeenCalled();
    expect(plugins.isActive).toHaveBeenCalledWith('valheim');
  });

  it('still deletes the inferred death of a removed picture (cleanup, not classifying)', async () => {
    const classifier = await build();
    plugins.isActive.mockReturnValue(false);
    const where = jest.fn().mockResolvedValue(undefined);
    db.delete.mockReturnValue({ where });
    await classifier.afterRemove(HUB, [42]);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('deletes nothing for a hub that is not a Valheim server', async () => {
    const classifier = await build();
    await classifier.afterRemove({ ...HUB, gameSlug: 'other' }, [42]);
    expect(db.delete).not.toHaveBeenCalled();
  });
});
