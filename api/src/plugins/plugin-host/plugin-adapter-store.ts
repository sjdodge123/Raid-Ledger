/**
 * In-memory adapter maps behind PluginRegistryService (ROK-268).
 *
 * Adapters are stored as `extensionPoint → key → adapter(s)`, where `key` is a
 * game slug, a plugin id or `'*'` depending on the extension point. A
 * registration may optionally name its owning plugin; owned adapters are
 * suspended when that plugin deactivates and restored when it re-activates,
 * independent of the plugin manifest's `gameSlugs`. Untagged registrations
 * keep the legacy game-slug removal only.
 */

/** Optional per-registration metadata. */
export interface AdapterRegistrationOptions {
  /**
   * Plugin id that owns this adapter — suspended/restored with that plugin.
   * Registering while the owner is inactive lands the adapter suspended.
   */
  ownerPluginId?: string;
}

/** Whether a plugin is currently active (defaults to always-active). */
export type OwnerActivePredicate = (pluginId: string) => boolean;

interface SuspendedEntry {
  multi: boolean;
  point: string;
  key: string;
  adapter: unknown;
}

export class PluginAdapterStore {
  private readonly adapters = new Map<string, Map<string, unknown>>();
  private readonly multiAdapters = new Map<string, Map<string, unknown[]>>();
  private readonly owners = new Map<unknown, string>();
  private readonly suspended = new Map<string, SuspendedEntry[]>();

  constructor(
    private readonly isOwnerActive: OwnerActivePredicate = () => true,
  ) {}

  registerAdapter(
    point: string,
    key: string,
    adapter: unknown,
    opts?: AdapterRegistrationOptions,
  ): void {
    let keyMap = this.adapters.get(point);
    if (!keyMap) {
      keyMap = new Map<string, unknown>();
      this.adapters.set(point, keyMap);
    }
    keyMap.set(key, adapter);
    this.recordOwner(adapter, opts);
  }

  getAdapter<T>(point: string, key: string): T | undefined {
    return this.adapters.get(point)?.get(key) as T | undefined;
  }

  getAdaptersForExtensionPoint<T>(point: string): Map<string, T> {
    const keyMap = this.adapters.get(point);
    if (!keyMap) return new Map<string, T>();
    return new Map(keyMap) as Map<string, T>;
  }

  /**
   * Add an adapter to the multi-adapter list for `point`/`key`. Idempotent per
   * instance — re-registering the same object does not duplicate it.
   * @returns the list length after registration
   */
  registerMultiAdapter(
    point: string,
    key: string,
    adapter: unknown,
    opts?: AdapterRegistrationOptions,
  ): number {
    let keyMap = this.multiAdapters.get(point);
    if (!keyMap) {
      keyMap = new Map<string, unknown[]>();
      this.multiAdapters.set(point, keyMap);
    }
    let list = keyMap.get(key);
    if (!list) {
      list = [];
      keyMap.set(key, list);
    }
    if (!list.includes(adapter)) list.push(adapter);
    this.recordOwner(adapter, opts);
    return this.getMultiAdapters(point, key).length;
  }

  getMultiAdapters<T>(point: string, key: string): T[] {
    const keyMap = this.multiAdapters.get(point);
    if (!keyMap) return [];
    return (keyMap.get(key) ?? []) as T[];
  }

  /** Legacy removal: drop every adapter registered under any of `keys`. */
  removeByKeys(keys: readonly string[]): void {
    for (const [, keyMap] of this.adapters) {
      for (const key of keys) keyMap.delete(key);
    }
    for (const [, keyMap] of this.multiAdapters) {
      for (const key of keys) keyMap.delete(key);
    }
  }

  /**
   * Remove every adapter owned by `pluginId` and remember it for restore.
   * Idempotent. @returns how many adapters were suspended by this call
   */
  suspendAdaptersOwnedBy(pluginId: string): number {
    const moved = [
      ...this.suspendSingles(pluginId),
      ...this.suspendMultis(pluginId),
    ];
    if (moved.length === 0) return 0;
    const existing = this.suspended.get(pluginId) ?? [];
    this.suspended.set(pluginId, [...existing, ...moved]);
    return moved.length;
  }

  /**
   * Re-insert the adapters suspended for `pluginId`. A single adapter is only
   * restored when its key is still empty (never clobbers a newer registration);
   * multi adapters go through the idempotent path. @returns entries processed
   */
  restoreAdaptersOwnedBy(pluginId: string): number {
    const entries = this.suspended.get(pluginId);
    if (!entries) return 0;
    this.suspended.delete(pluginId);
    for (const entry of entries) this.restoreEntry(entry);
    return entries.length;
  }

  /** Restore every suspended owner the predicate now reports active. */
  restoreActiveOwners(): number {
    let restored = 0;
    for (const pluginId of [...this.suspended.keys()]) {
      if (this.isOwnerActive(pluginId))
        restored += this.restoreAdaptersOwnedBy(pluginId);
    }
    return restored;
  }

  private restoreEntry(entry: SuspendedEntry): void {
    if (entry.multi) {
      this.registerMultiAdapter(entry.point, entry.key, entry.adapter);
      return;
    }
    if (this.adapters.get(entry.point)?.has(entry.key)) return;
    this.registerAdapter(entry.point, entry.key, entry.adapter);
  }

  private recordOwner(
    adapter: unknown,
    opts: AdapterRegistrationOptions | undefined,
  ): void {
    const owner = opts?.ownerPluginId;
    if (owner === undefined) return;
    this.owners.set(adapter, owner);
    if (!this.isOwnerActive(owner)) this.suspendAdaptersOwnedBy(owner);
  }

  private isOwnedBy(adapter: unknown, pluginId: string): boolean {
    return this.owners.get(adapter) === pluginId;
  }

  private suspendSingles(pluginId: string): SuspendedEntry[] {
    const moved: SuspendedEntry[] = [];
    for (const [point, keyMap] of this.adapters) {
      for (const [key, adapter] of keyMap) {
        if (!this.isOwnedBy(adapter, pluginId)) continue;
        keyMap.delete(key);
        moved.push({ multi: false, point, key, adapter });
      }
      if (keyMap.size === 0) this.adapters.delete(point);
    }
    return moved;
  }

  private suspendMultis(pluginId: string): SuspendedEntry[] {
    const moved: SuspendedEntry[] = [];
    for (const [point, keyMap] of this.multiAdapters) {
      for (const [key, list] of keyMap) {
        const kept = list.filter((a) => !this.isOwnedBy(a, pluginId));
        for (const adapter of list) {
          if (this.isOwnedBy(adapter, pluginId))
            moved.push({ multi: true, point, key, adapter });
        }
        if (kept.length === 0) keyMap.delete(key);
        else if (kept.length !== list.length) keyMap.set(key, kept);
      }
      if (keyMap.size === 0) this.multiAdapters.delete(point);
    }
    return moved;
  }
}
