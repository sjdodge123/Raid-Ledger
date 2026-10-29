import type { HubMediaSourceGateRegistry } from '../../../hub-media/hub-media.source-gates';
import * as ingestSources from '../../../hub-media/hub-media-ingest-sources';
import { BG3_PLUGIN_ID } from '../bg3.constants';
import type { Bg3ReadRepository } from '../read/bg3-read.repository';
import { Bg3GalleryRegistrations } from './bg3-gallery.registrations';

function setup(hide: boolean) {
  const gates = {
    register: jest.fn<
      void,
      [string, string, (g: number) => Promise<boolean>]
    >(),
  };
  const read = {
    settings: jest.fn().mockResolvedValue({
      hideLocationAndScreenshots: hide,
      activeCampaignId: null,
    }),
  };
  const regs = new Bg3GalleryRegistrations(
    gates as unknown as HubMediaSourceGateRegistry,
    read as unknown as Bg3ReadRepository,
  );
  return { regs, gates, read };
}

describe('Bg3GalleryRegistrations (ROK-1959 D-5 / D-12)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('registers the bg3-owned ingest source and the bg3-save media gate', () => {
    const spy = jest
      .spyOn(ingestSources, 'registerHubIngestSource')
      .mockImplementation(() => undefined);
    const { regs, gates } = setup(false);
    regs.onModuleInit();
    expect(spy).toHaveBeenCalledWith(BG3_PLUGIN_ID, 'bg3-save.gallery');
    expect(gates.register).toHaveBeenCalledWith(
      BG3_PLUGIN_ID,
      'bg3-save',
      expect.any(Function),
    );
  });

  it.each([
    [true, true],
    [false, false],
  ])(
    'the gate follows the hub spoiler toggle (hide=%s → %s)',
    async (hide, hidden) => {
      jest
        .spyOn(ingestSources, 'registerHubIngestSource')
        .mockImplementation(() => undefined);
      const { regs, gates, read } = setup(hide);
      regs.onModuleInit();
      const gate = gates.register.mock.calls[0]?.[2];
      if (!gate) throw new Error('no media gate registered');
      await expect(gate(9)).resolves.toBe(hidden);
      expect(read.settings).toHaveBeenCalledWith(9);
    },
  );
});
