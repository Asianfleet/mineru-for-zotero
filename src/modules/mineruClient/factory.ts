import { createOnlineAgentLiteMinerUClient } from "./agentLite";
import { createLocalMinerUClient } from "./local";
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
  if (options.source === "online" && options.mode === "lite") {
    return createOnlineAgentLiteMinerUClient(options);
  }
  if (options.source === "local") {
    return createLocalMinerUClient({
      ...options,
      mode: options.mode,
      localApiBaseURL: options.localApiBaseURL ?? "http://127.0.0.1:8000",
      saveImages: options.saveImages,
    });
  }
  throw new Error(
    `Unsupported MinerU client mode: ${options.source}/${options.mode}`,
  );
}
