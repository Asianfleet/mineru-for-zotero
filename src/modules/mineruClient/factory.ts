import { createOnlinePreciseMinerUClient } from "./onlinePrecise";
import type { MinerUClient, MinerUClientFactoryOptions } from "./types";

/**
 * 根据当前 parse source 和 parse mode 选择对应的 MinerU client。
 */
export function createMinerUClientForSettings(
  options: MinerUClientFactoryOptions,
): MinerUClient {
  if (options.source === "online" && options.mode === "precise") {
    return createOnlinePreciseMinerUClient(options);
  }
  throw new Error(
    `Unsupported MinerU client mode: ${options.source}/${options.mode}`,
  );
}
