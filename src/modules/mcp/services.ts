import { getMinerUStorageRoot } from "../preferenceScript";
import { createStorage, StorageAdapter } from "../storage";
import {
  createMarkdownQueryService,
  MarkdownQueryService,
} from "../markdownQuery/queryService";
import type { ZoteroItemLike } from "../markdownQuery/types";
import { createLatexQueryService } from "../latexQuery/service";
import { createTexSourceStorage } from "../texSource/storage";
import { fetchLatex as fetchLatexSource } from "../sourceQuery/apiEndpoint";

/** MCP 查询层共享的 Markdown、LaTeX 和图片存储依赖。 */
export interface McpQueryContext {
  markdown: MarkdownQueryService;
  latex: ReturnType<typeof createLatexQueryService>;
  markdownStorage: StorageAdapter;
  texStorage: ReturnType<typeof createTexSourceStorage>;
  fetchLatex(input: {
    libraryID: number;
    key: string;
    refresh: boolean;
    mainFile?: string;
  }): Promise<unknown>;
  readLatexImages(input: {
    libraryID: number;
    key: string;
    paths: string[];
  }): Promise<
    Array<{ path: string; status: string; mime?: string; dataURL?: string }>
  >;
}

/** 创建 MCP 使用的查询上下文，避免 MCP 通过 HTTP 回环调用旧 endpoint。 */
export function createMcpQueryContext(): McpQueryContext {
  const markdownStorage = createStorage(getMinerUStorageRoot());
  const texStorage = createTexSourceStorage(getMinerUStorageRoot());
  const items = Zotero.Items;
  const markdown = createMarkdownQueryService({
    items,
    storage: markdownStorage,
    searchItemsByTitle,
  });
  const latex = createLatexQueryService({
    store: texStorage,
    getItem: (libraryID, key) => items.getByLibraryAndKeyAsync(libraryID, key),
  });

  return {
    markdown,
    latex,
    markdownStorage,
    texStorage,
    fetchLatex: (input) =>
      fetchLatexSource(
        texStorage,
        input.libraryID,
        input.key,
        input.refresh,
        input.mainFile,
      ),
    readLatexImages: (input) => readLatexImagesForMcp(texStorage, input),
  };
}

/** 读取 LaTeX 图片并将单图错误也保留为逐项 MCP 状态。 */
async function readLatexImagesForMcp(
  store: ReturnType<typeof createTexSourceStorage>,
  input: { libraryID: number; key: string; paths: string[] },
) {
  const seen = new Set<string>();
  const images: Array<{
    path: string;
    status: string;
    mime?: string;
    dataURL?: string;
  }> = [];
  for (const path of input.paths) {
    if (seen.has(path)) {
      images.push({ path, status: "duplicate-path" });
      continue;
    }
    seen.add(path);
    try {
      const image = await store.readImage(input, path);
      images.push({
        path: image.path,
        status: "ok",
        mime: image.mime,
        dataURL: bytesToDataUrl(image.mime, image.bytes),
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "internal-error";
      if (code !== "invalid-path" && code !== "tex-image-not-found") {
        throw error;
      }
      images.push({ path, status: code });
    }
  }
  return images;
}

/** 将 LaTeX 图片字节转换成 MCP 映射器可解码的 data URL。 */
function bytesToDataUrl(mime: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

/** 通过 Zotero 标题条件检索条目，供 MCP 搜索工具使用。 */
async function searchItemsByTitle(input: {
  libraryID: number;
  title: string;
}): Promise<ZoteroItemLike[]> {
  const search = new Zotero.Search({ libraryID: input.libraryID });
  search.addCondition("title", "contains", input.title);
  const ids = await search.search();
  return Zotero.Items.getAsync(ids);
}
