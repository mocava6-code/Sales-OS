import type { ChannelAdapter } from "../channel-adapter";
import type { ChannelType } from "../types";
import { manualPasteChannelAdapter } from "./manual-paste-adapter";

const DEFAULT_ADAPTERS: ChannelAdapter[] = [manualPasteChannelAdapter];

// A small registry, not a plugin system: built-in adapters plus whatever
// overrides/additions a caller injects, keyed by channel. Later overrides
// win, so a caller can substitute a real "whatsapp" adapter later without
// touching this file.
export function createChannelAdapterRegistry(overrides: ChannelAdapter[] = []) {
  const adapters = new Map<ChannelType, ChannelAdapter>();

  for (const adapter of [...DEFAULT_ADAPTERS, ...overrides]) {
    adapters.set(adapter.channel, adapter);
  }

  return {
    get(channel: ChannelType): ChannelAdapter | undefined {
      return adapters.get(channel);
    },
  };
}
