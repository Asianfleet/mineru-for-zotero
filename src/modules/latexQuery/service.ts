import {
  expandLatexSource,
  extractLatexTables,
  parseLatexHeadings,
  searchLatex,
  type LatexSourceFile,
} from "./parser";
import { createLatexDocumentIndex } from "./documentIndex";

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
    const document = createLatexDocumentIndex(segments);
    return { item, source, segments, document };
  }

  return {
    async read(input: {
      libraryID: number;
      key: string;
      granularity?: "full" | "headings" | "section" | "search";
      query?: string;
      sectionPath?: string;
      sectionNumber?: string;
      contextParagraphs?: number;
    }) {
      if (input.sectionNumber !== undefined) throw new Error("invalid-request");
      const granularity = input.granularity ?? "full";
      if (!["full", "headings", "section", "search"].includes(granularity))
        throw new Error("invalid-request");
      if (granularity === "section" && !input.sectionPath?.trim())
        throw new Error("missing-query");
      if (granularity === "search" && !input.query?.trim())
        throw new Error("missing-query");
      const loaded = await load(input);
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
        return {
          ...base,
          headings: parseLatexHeadings(loaded.segments, loaded.document),
        };
      }
      if (granularity === "search") {
        return {
          ...base,
          query: input.query,
          matches: searchLatex(
            loaded.segments,
            input.query!,
            input.contextParagraphs,
            loaded.document,
          ),
        };
      }
      if (granularity === "section") {
        const requested = input.sectionPath!.trim();
        const headings = parseLatexHeadings(loaded.segments, loaded.document);
        const parts = requested
          .split("/")
          .map((part) => part.trim().toLowerCase());
        const matches = headings.filter((candidate) => {
          const path = candidate.path.map((part) => part.toLowerCase());
          return parts.length === 1
            ? candidate.title.toLowerCase() === parts[0]
            : path.length === parts.length &&
                path.every((part, index) => part === parts[index]);
        });
        if (matches.length === 0) throw new Error("section-not-found");
        if (matches.length > 1) {
          throw Object.assign(new Error("ambiguous-section"), {
            candidates: matches.map(({ path, file, line }) => ({
              path,
              file,
              line,
            })),
          });
        }
        const heading = matches[0];
        const next = headings.find(
          (candidate) =>
            candidate.offset > heading.offset &&
            candidate.level <= heading.level,
        );
        const content = loaded.document.text.slice(
          heading.offset,
          next?.offset ?? loaded.document.text.length,
        );
        return { ...base, heading, content };
      }
      const content = loaded.document.text;
      return { ...base, content };
    },
    async table(input: { libraryID: number; key: string; query: string }) {
      const loaded = await load(input);
      const query = input.query.trim().toLowerCase();
      const tables = extractLatexTables(
        loaded.segments,
        loaded.document,
      ).filter((table) =>
        [table.caption, table.label, table.content]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query)),
      );
      return { source: "latex" as const, query: input.query, tables };
    },
  };
}
