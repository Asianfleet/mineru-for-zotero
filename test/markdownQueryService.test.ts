import { assert } from "chai";
import type { NormalizedBox } from "../src/modules/domain";
import { createMarkdownQueryService } from "../src/modules/markdownQuery/queryService";
import {
  MarkdownQueryError,
  ZoteroItemLike,
  ZoteroItemsGateway,
} from "../src/modules/markdownQuery/types";

describe("markdownQueryService", function () {
  it("returns full markdown after resolving an attachment", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({ markdown: "# Precise" }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.include(JSON.stringify(response), "# Precise");
  });

  it("reports precise mode when precise and lite results are both ready", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Precise",
        parseStatus: {
          preciseReady: true,
          liteReady: true,
        },
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.nestedPropertyVal(response, "result.source", "preferred");
    assert.nestedPropertyVal(response, "result.mode", "precise");
  });

  it("uses preferred markdown so lite-only results can be returned", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Lite",
        parseStatus: {
          preciseReady: false,
          liteReady: true,
        },
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.include(JSON.stringify(response), "# Lite");
    assert.nestedPropertyVal(response, "result.mode", "lite");
  });

  it("returns heading granularity", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({ markdown: "# A\n\n## B" }),
    );
    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "headings",
    });

    assert.deepInclude(response, { granularity: "headings" });
    assert.include(JSON.stringify(response), '"title":"B"');
  });

  it("returns section granularity", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc\n\n## Methods\n\nAlpha\n\n## Results\n\nBeta",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "section",
      sectionPath: ["Doc", "Methods"],
    });

    assert.deepInclude(response, { granularity: "section" });
    assert.nestedPropertyVal(response, "groups[0].query", "Doc / Methods");
    assert.nestedPropertyVal(
      response,
      "groups[0].matches[0].heading.title",
      "Methods",
    );
    assert.nestedPropertyVal(
      response,
      "groups[0].matches[0].content",
      "## Methods\n\nAlpha",
    );
  });

  it("keeps legacy sectionPath arrays as exact section queries", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown:
          "# Doc\n\n## Methods\n\nAlpha\n\n### Setup\n\nBeta\n\n## Results\n\nGamma",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "section",
      sectionPath: ["Doc", "Methods"],
    });

    assert.deepInclude(response, { granularity: "section" });
    assert.nestedPropertyVal(response, "groups[0].query", "Doc / Methods");
    assert.nestedPropertyVal(response, "groups[0].kind", "section-path");
    assert.nestedPropertyVal(response, "groups[0].status", "ok");
    assert.lengthOf(
      ((response as { groups: unknown[] }).groups[0] as { matches: unknown[] })
        .matches,
      1,
    );
    assert.nestedPropertyVal(
      response,
      "groups[0].matches[0].heading.title",
      "Methods",
    );
    assert.nestedPropertyVal(
      response,
      "groups[0].matches[0].content",
      "## Methods\n\nAlpha\n\n### Setup\n\nBeta",
    );
  });

  it("returns not-found group status for missing legacy sectionPath arrays", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc\n\n## Methods\n\nAlpha",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "section",
      sectionPath: ["Doc", "Discussion"],
    });

    assert.deepInclude(response, { granularity: "section" });
    assert.nestedPropertyVal(response, "groups[0].query", "Doc / Discussion");
    assert.nestedPropertyVal(response, "groups[0].kind", "section-path");
    assert.nestedPropertyVal(response, "groups[0].status", "not-found");
    assert.deepEqual(
      ((response as { groups: unknown[] }).groups[0] as { matches: unknown[] })
        .matches,
      [],
    );
  });

  it("returns ambiguous group status for duplicate legacy sectionPath arrays", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc\n\n## Methods\n\nAlpha\n\n# Doc\n\n## Methods\n\nBeta",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "section",
      sectionPath: ["Doc", "Methods"],
    });

    assert.deepInclude(response, { granularity: "section" });
    assert.nestedPropertyVal(response, "groups[0].query", "Doc / Methods");
    assert.nestedPropertyVal(response, "groups[0].kind", "section-path");
    assert.nestedPropertyVal(response, "groups[0].status", "ambiguous");
    assert.deepEqual(
      ((response as { groups: unknown[] }).groups[0] as { matches: unknown[] })
        .matches,
      [],
    );
    assert.lengthOf(
      (
        (response as { groups: unknown[] }).groups[0] as {
          candidates: unknown[];
        }
      ).candidates,
      2,
    );
  });

  it("returns grouped section results", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc\n\n## 5.1 Setup\n\nAlpha\n\n## 5.2 Results\n\nBeta",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "section",
      sectionNumber: "5.1,5.2",
    });

    assert.deepInclude(response, { granularity: "section" });
    assert.nestedPropertyVal(response, "groups[0].query", "5.1");
    assert.nestedPropertyVal(
      response,
      "groups[0].matches[0].heading.title",
      "5.1 Setup",
    );
    assert.nestedPropertyVal(response, "groups[1].query", "5.2");
  });

  it("returns search granularity", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc\n\nIntro\n\nNeedle appears here.\n\nTail",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "search",
      q: "needle",
      contextParagraphs: 1,
    });

    assert.deepInclude(response, { granularity: "search", query: "needle" });
    assert.nestedPropertyVal(
      response,
      "matches[0].hit",
      "Needle appears here.",
    );
    assert.nestedPropertyVal(response, "matches[0].before[0]", "Intro");
    assert.nestedPropertyVal(response, "matches[0].after[0]", "Tail");
  });

  it("queries tables by caption or content", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown:
          "# Doc\n\nTable 2: Dataset statistics\n\n<table><tr><td>WikiTable</td></tr></table>",
        boxes: [
          {
            rawIndex: 7,
            page: 3,
            type: "table",
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            markdown: "",
            formula: null,
            tableFormats: {
              html: "<table><tr><td>WikiTable</td></tr></table>",
            },
          },
        ],
      }),
    );

    const response = await (
      service as MarkdownQueryServiceWithTables
    ).queryTables({
      libraryID: 1,
      key: "PDF1",
      q: "WikiTable",
      match: "both",
      tableFormat: "markdown",
    });

    assert.nestedPropertyVal(response, "tables[0].rawIndex", 7);
    assert.include(
      String(
        (response as { tables: Array<{ content: string }> }).tables[0].content,
      ),
      "WikiTable",
    );
  });

  it("matches precise table boxes by captions in box markdown", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc",
        boxes: [
          {
            rawIndex: 8,
            page: 4,
            type: "table",
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            markdown:
              "Table 4: Ablation results\n\n<table><tr><td>Score</td></tr></table>",
            formula: null,
            tableFormats: {
              html: "<table><tr><td>Score</td></tr></table>",
            },
          },
        ],
      }),
    );

    const response = await service.queryTables({
      libraryID: 1,
      key: "PDF1",
      q: "Ablation results",
      match: "caption",
      tableFormat: "html",
    });

    assert.nestedPropertyVal(
      response,
      "tables[0].caption",
      "Table 4: Ablation results",
    );
    assert.nestedPropertyVal(response, "tables[0].rawIndex", 8);
  });

  it("matches precise table box HTML captions after decoding entities", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc",
        boxes: [
          {
            rawIndex: 9,
            page: 5,
            type: "table",
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            markdown: "",
            formula: null,
            tableFormats: {
              html: [
                "<table>",
                "<caption>R&amp;D Results</caption>",
                "<tr><td>Score</td></tr>",
                "</table>",
              ].join(""),
            },
          },
        ],
      }),
    );

    const response = await service.queryTables({
      libraryID: 1,
      key: "PDF1",
      q: "R&D",
      match: "caption",
      tableFormat: "html",
    });

    assert.nestedPropertyVal(response, "tables[0].caption", "R&D Results");
    assert.nestedPropertyVal(response, "tables[0].rawIndex", 9);
  });

  it("uses nearby Markdown captions and requested format for fallback tables", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown:
          "# Doc\n\nTable 5: Dataset statistics\n<table><tr><th>Name</th></tr><tr><td>WikiTable</td></tr></table>",
        boxes: [],
      }),
    );

    const response = await service.queryTables({
      libraryID: 1,
      key: "PDF1",
      q: "Dataset statistics",
      match: "caption",
      tableFormat: "markdown",
    });
    const table = (
      response as {
        tables: Array<{ content: string; formats: Record<string, string> }>;
      }
    ).tables[0];

    assert.include(table.content, "Name");
    assert.include(table.content, "WikiTable");
    assert.notEqual(table.content, "name wikitable");
    assert.deepEqual(Object.keys(table.formats).sort(), ["html", "markdown"]);
    assert.include(table.formats.html, "<table>");
    assert.include(table.formats.markdown, "Name");
    assert.include(table.formats.markdown, "WikiTable");
  });

  it("matches fallback HTML table captions with caption-only queries", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown:
          "# Doc\n\n<table><caption>Dataset Summary</caption><tr><td>WikiTable</td></tr></table>",
        boxes: [],
      }),
    );

    const response = await service.queryTables({
      libraryID: 1,
      key: "PDF1",
      q: "Dataset Summary",
      match: "caption",
      tableFormat: "markdown",
    });

    assert.nestedPropertyVal(response, "tables[0].caption", "Dataset Summary");
    assert.nestedPropertyVal(response, "tables[0].rawIndex", 0);
  });

  it("does not duplicate markdown fallback tables when box tables are available", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown:
          "# Doc\n\n<table><caption>Dataset Summary</caption><tr><td>WikiTable</td></tr></table>",
        boxes: [
          {
            rawIndex: 7,
            page: 3,
            type: "table",
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            markdown: "",
            formula: null,
            tableFormats: {
              html: "<table><caption>Dataset Summary</caption><tr><td>WikiTable</td></tr></table>",
            },
          },
        ],
      }),
    );

    const response = await service.queryTables({
      libraryID: 1,
      key: "PDF1",
      q: "WikiTable",
      match: "both",
      tableFormat: "markdown",
    });
    const tables = (response as { tables: Array<{ rawIndex?: number }> })
      .tables;

    assert.lengthOf(tables, 1);
    assert.equal(tables[0].rawIndex, 7);
  });

  it("reads image bytes and reports invalid, missing, or nested image paths", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc",
        readImage: async (_ref, path) =>
          ["images/a.jpg", "images/nested/b.jpg"].includes(path)
            ? {
                path,
                mime: "image/jpeg",
                bytes: new Uint8Array(
                  path === "images/a.jpg" ? [1, 2, 3] : [4, 5, 6],
                ),
                dataURL:
                  path === "images/a.jpg"
                    ? "data:image/jpeg;base64,AQID"
                    : "data:image/jpeg;base64,BAUG",
              }
            : null,
      }),
    );

    const response = await service.readImages({
      libraryID: 1,
      key: "PDF1",
      path: "images/a.jpg, images/nested/b.jpg, ../secret.png, images/./bad.jpg, images/missing.png",
    });

    assert.deepEqual(
      response.images.map((image) => ({
        path: image.path,
        status: image.status,
        mime: image.mime,
        bytes: image.bytes ? Array.from(image.bytes) : undefined,
      })),
      [
        {
          path: "images/a.jpg",
          status: "ok",
          mime: "image/jpeg",
          bytes: [1, 2, 3],
        },
        {
          path: "images/nested/b.jpg",
          status: "ok",
          mime: "image/jpeg",
          bytes: [4, 5, 6],
        },
        {
          path: "../secret.png",
          status: "invalid-path",
          mime: undefined,
          bytes: undefined,
        },
        {
          path: "images/./bad.jpg",
          status: "invalid-path",
          mime: undefined,
          bytes: undefined,
        },
        {
          path: "images/missing.png",
          status: "not-found",
          mime: undefined,
          bytes: undefined,
        },
      ],
    );
  });

  it("rejects empty image path lists", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Doc",
      }),
    );

    await assertRejectsCode(
      () =>
        service.readImages({
          libraryID: 1,
          key: "PDF1",
          path: ",,,",
        }),
      "invalid-request",
    );
  });

  it("maps missing markdown to parse-result-not-found", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Missing",
        parseStatus: {
          preciseReady: false,
          liteReady: false,
        },
        readPreferredMarkdown: async () => {
          throw new Error("not found");
        },
      }),
    );

    await assertRejectsCode(
      () => service.queryMarkdown({ libraryID: 1, key: "PDF1" }),
      "parse-result-not-found",
    );
  });

  it("does not remap read failures when parse status says a result exists", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Missing",
        parseStatus: {
          preciseReady: true,
          liteReady: false,
        },
        readPreferredMarkdown: async () => {
          throw new Error("zip corrupted");
        },
      }),
    );

    await assertRejectsMessage(
      () => service.queryMarkdown({ libraryID: 1, key: "PDF1" }),
      "zip corrupted",
    );
  });

  it("searchByTitle returns candidate metadata without markdown content", async function () {
    const parent = fakeItem({
      id: 2,
      key: "ITEM1",
      regular: true,
      title: "Regular Item",
      attachments: [1],
    });
    const pdf = fakeItem({
      id: 1,
      key: "PDF1",
      pdf: true,
      fileName: "paper.pdf",
      parentItemID: 2,
    });
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Hidden",
        items: [parent, pdf],
        searchItemsByTitle: async () => [parent],
      }),
    );

    const response = await service.searchByTitle({
      libraryID: 1,
      title: "Regular",
    });

    assert.deepEqual(response, {
      candidates: [
        {
          item: {
            itemID: 2,
            libraryID: 1,
            key: "ITEM1",
            type: "regular",
            title: "Regular Item",
          },
          attachments: [
            {
              itemID: 1,
              libraryID: 1,
              key: "PDF1",
              fileName: "paper.pdf",
              preciseReady: true,
              liteReady: true,
            },
          ],
        },
      ],
    });
    assert.notInclude(JSON.stringify(response), "Hidden");
    assert.notProperty(response as Record<string, unknown>, "content");
  });
});

function fakeDeps(input: {
  markdown: string;
  boxes?: NormalizedBox[];
  items?: ZoteroItemLike[];
  parseStatus?: {
    preciseReady: boolean;
    liteReady: boolean;
  };
  readPreferredMarkdown?: (ref: {
    libraryID: number;
    key: string;
  }) => Promise<string>;
  readImage?: (
    ref: { libraryID: number; key: string },
    path: string,
  ) => Promise<{
    path: string;
    mime: string;
    bytes: Uint8Array;
    dataURL: string;
  } | null>;
  searchItemsByTitle?: (input: {
    libraryID: number;
    title: string;
  }) => Promise<ZoteroItemLike[]>;
}) {
  const pdf =
    input.items?.find((item) => item.key === "PDF1") ??
    fakeItem({
      id: 1,
      key: "PDF1",
      pdf: true,
      fileName: "paper.pdf",
    });
  const items = input.items ?? [pdf];
  const parseStatus = input.parseStatus ?? {
    preciseReady: true,
    liteReady: true,
  };

  const storage = {
    async readPreferredMarkdown(ref: { libraryID: number; key: string }) {
      if (input.readPreferredMarkdown) {
        return input.readPreferredMarkdown(ref);
      }
      return input.markdown;
    },
    async readParseStatus() {
      return parseStatus;
    },
    async readBoxes() {
      return input.boxes ?? [];
    },
    async readImage(ref: { libraryID: number; key: string }, path: string) {
      return input.readImage?.(ref, path) ?? null;
    },
  };

  return {
    items: fakeItems(items),
    storage,
    async searchItemsByTitle(searchInput: {
      libraryID: number;
      title: string;
    }) {
      if (input.searchItemsByTitle) {
        return input.searchItemsByTitle(searchInput);
      }
      return [pdf];
    },
  };
}

interface MarkdownQueryServiceWithTables {
  queryTables(input: {
    libraryID: number;
    key: string;
    q: string;
    match: "caption" | "content" | "both";
    tableFormat: "markdown";
  }): Promise<unknown>;
}

function fakeItem(input: {
  id: number;
  key: string;
  regular?: boolean;
  pdf?: boolean;
  title?: string;
  fileName?: string;
  dateAdded?: string;
  parentItemID?: number | false;
  attachments?: number[];
  bestAttachments?: ZoteroItemLike[];
}): ZoteroItemLike {
  return {
    id: input.id,
    key: input.key,
    libraryID: 1,
    dateAdded:
      input.dateAdded ??
      `2026-01-${String(input.id).padStart(2, "0")} 00:00:00`,
    attachmentFilename: input.fileName ?? `${input.key}.pdf`,
    parentItemID: input.parentItemID,
    isRegularItem: () => Boolean(input.regular),
    isPDFAttachment: () => Boolean(input.pdf),
    getDisplayTitle: () => input.title ?? input.fileName ?? input.key,
    getField: (field) => (field === "title" ? (input.title ?? "") : ""),
    getAttachments: () => input.attachments ?? [],
    getBestAttachments: async () => input.bestAttachments ?? [],
  };
}

function fakeItems(items: ZoteroItemLike[]): ZoteroItemsGateway {
  return {
    async getAsync(ids) {
      return ids.map((id) => {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) {
          throw new Error(`missing fake item ${id}`);
        }
        return item;
      });
    },
    async getByLibraryAndKeyAsync(libraryID, key) {
      return (
        items.find(
          (item) => item.libraryID === libraryID && item.key === key,
        ) ?? false
      );
    },
  };
}

async function assertRejectsCode(
  callback: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    assert.instanceOf(error, MarkdownQueryError);
    assert.equal((error as MarkdownQueryError).code, code);
    return;
  }

  assert.fail(`Expected ${code}`);
}

async function assertRejectsMessage(
  callback: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    assert.instanceOf(error, Error);
    assert.notInstanceOf(error, MarkdownQueryError);
    assert.include((error as Error).message, message);
    return;
  }

  assert.fail(`Expected ${message}`);
}
