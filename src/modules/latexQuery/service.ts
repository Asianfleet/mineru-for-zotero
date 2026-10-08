import {
  expandLatexSource,
  extractLatexTables,
  parseLatexHeadings,
  searchLatex,
  type LatexSourceFile,
} from "./parser";

export interface LatexSourceStore {
  read(ref: { libraryID: number; key: string }): Promise<{
    files: LatexSourceFile[];
    mainFile: string;
    manifest: Record<string, unknown>;
  }>;
}

export interface LatexItem {
  id: number;
  key: string;
  libraryID: number;
  getField(field: string): string;
  getDisplayTitle(): string;
}

/** 组合源码存储与 LaTeX parser，提供稳定的 read/table 查询结果。 */
export function createLatexQueryService(deps: {
  store: LatexSourceStore;
  getItem(libraryID: number, key: string): Promise<LatexItem | false>;
}) {
  async function load(input: { libraryID: number; key: string }) {
    const item = await deps.getItem(input.libraryID, input.key);
    if (!item) throw new Error("item-not-found");
    let source;
    try {
      source = await deps.store.read(input);
    } catch {
      throw new Error("tex-source-not-found");
    }
    const segments = expandLatexSource(source.files, source.mainFile);
    return { item, source, segments };
  }

  return {
    async read(input: {
      libraryID: number;
      key: string;
      granularity?: "full" | "headings" | "section" | "search";
      query?: string;
    }) {
      const loaded = await load(input);
      const granularity = input.granularity ?? "full";
      const base = {
        item: {
          itemID: loaded.item.id,
          libraryID: loaded.item.libraryID,
          key: loaded.item.key,
          title: loaded.item.getDisplayTitle() || loaded.item.getField("title"),
        },
        source: "latex" as const,
        mainFile: loaded.source.mainFile,
        manifest: loaded.source.manifest,
        granularity,
      };
      if (granularity === "headings") {
        return { ...base, headings: parseLatexHeadings(loaded.segments) };
      }
      if (granularity === "search") {
        return {
          ...base,
          query: input.query ?? "",
          matches: searchLatex(loaded.segments, input.query ?? ""),
        };
      }
      if (granularity === "section") {
        const headings = parseLatexHeadings(loaded.segments);
        const requested = input.query?.trim() ?? "";
        const heading = headings.find(
          (candidate) =>
            candidate.path.join("/").toLowerCase() ===
              requested.toLowerCase() ||
            candidate.title.toLowerCase() === requested.toLowerCase(),
        );
        if (!heading) throw new Error("section-not-found");
        const segment = loaded.segments.find(
          (candidate) => candidate.file === heading.file,
        );
        const content = segment?.text ?? "";
        return { ...base, heading, content };
      }
      const content = loaded.segments.map((segment) => segment.text).join("\n");
      return { ...base, content };
    },
    async table(input: { libraryID: number; key: string; query: string }) {
      const loaded = await load(input);
      const query = input.query.trim().toLowerCase();
      const tables = extractLatexTables(loaded.segments).filter((table) =>
        [table.caption, table.label, table.content]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
      );
      return { source: "latex" as const, query: input.query, tables };
    },
  };
}
