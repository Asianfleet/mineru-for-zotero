import { assert } from "chai";
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
    assert.nestedPropertyVal(response, "heading.title", "Methods");
    assert.propertyVal(response, "content", "## Methods\n\nAlpha");
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
  items?: ZoteroItemLike[];
  parseStatus?: {
    preciseReady: boolean;
    liteReady: boolean;
  };
  readPreferredMarkdown?: (ref: {
    libraryID: number;
    key: string;
  }) => Promise<string>;
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

  return {
    items: fakeItems(items),
    storage: {
      async readPreferredMarkdown(ref: { libraryID: number; key: string }) {
        if (input.readPreferredMarkdown) {
          return input.readPreferredMarkdown(ref);
        }
        return input.markdown;
      },
      async readParseStatus() {
        return parseStatus;
      },
    },
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
