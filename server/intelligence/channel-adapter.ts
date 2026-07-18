import type { ChannelType, NormalizedMessage } from "./types";

// Mechanical, non-reasoning normalization only: raw channel input -> canonical
// messages. No fact extraction, no model calls happen inside an adapter.
export interface ChannelAdapter {
  readonly channel: ChannelType;
  normalize(rawInput: string): NormalizedMessage[];
}
