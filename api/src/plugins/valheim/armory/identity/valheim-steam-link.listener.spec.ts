/** ROK-1969 — the Steam-link attach is a Valheim behaviour (off with the plugin); the unlink detach always runs. */
import type { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import type { ValheimIdentityService } from './valheim-identity.service';
import { ValheimSteamLinkListener } from './valheim-steam-link.listener';

function build(active: boolean): {
  listener: ValheimSteamLinkListener;
  attach: jest.Mock;
  detach: jest.Mock;
} {
  const attach = jest.fn().mockResolvedValue(undefined);
  const detach = jest.fn().mockResolvedValue(undefined);
  const identity: unknown = { attachForUser: attach, detachForUser: detach };
  const registry: unknown = {
    isActive: (slug: string) => active && slug === 'valheim',
  };
  const listener = new ValheimSteamLinkListener(
    identity as ValheimIdentityService,
    registry as PluginRegistryService,
  );
  return { listener, attach, detach };
}

const event = { userId: 7, steamId64: '76561198000000000' };

describe('ValheimSteamLinkListener', () => {
  it('attaches and detaches while Valheim is active', async () => {
    const { listener, attach, detach } = build(true);
    await listener.handleLinked(event);
    await listener.handleUnlinked(event);
    expect(attach).toHaveBeenCalledWith(7, event.steamId64);
    expect(detach).toHaveBeenCalledWith(7, event.steamId64);
  });

  it('does not auto-claim on link while Valheim is inactive', async () => {
    const { listener, attach } = build(false);
    await listener.handleLinked(event);
    expect(attach).not.toHaveBeenCalled();
  });

  // ROK-1969 Codex P2: removing data a user withdrew never depends on a plugin toggle.
  it('still detaches auto claims on unlink while Valheim is inactive', async () => {
    const { listener, detach } = build(false);
    await listener.handleUnlinked(event);
    expect(detach).toHaveBeenCalledWith(7, event.steamId64);
  });
});
