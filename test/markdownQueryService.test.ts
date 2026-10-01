import { assert } from "chai";
import { createMarkdownQueryService } from "../src/modules/markdownQuery/queryService";
import {
  CreatorLike,
  ItemSearchInput,
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

  it("passes includeSubsections through to the section reader", async function () {
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown:
          "# Doc\n\n## 3. Section\n\nAlpha\n\n## 3.1. Sub\n\nSub body\n\n## 4. Next\n\nBeta",
      }),
    );

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "section",
      sectionPath: ["Doc", "3. Section"],
      includeSubsections: true,
    });

    assert.propertyVal(
      response,
      "content",
      "## 3. Section\n\nAlpha\n\n## 3.1. Sub\n\nSub body",
    );
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
        searchItems: async () => [parent],
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

  it("searchByTitle supports creator-only search without a title", async function () {
    let received;
    const deps = createMarkdownQueryService({
      items: fakeItems([]),
      storage: {
        async readPreferredMarkdown() {
          return "# X";
        },
        async readParseStatus() {
          return { preciseReady: true, liteReady: true };
        },
      },
      searchItems: async (input) => {
        received = input;
        return [];
      },
    });

    const response = await deps.searchByTitle({
      libraryID: 3,
      creator: "Chen",
      year: "2022",
      limit: 5,
    });

    assert.deepEqual(response, { candidates: [] });
    assert.deepEqual(received, {
      libraryID: 3,
      creator: "Chen",
      year: "2022",
      limit: 5,
    });
  });

  it("searchByTitle rejects requests without title or creator", async function () {
    const deps = createMarkdownQueryService({
      items: fakeItems([]),
      storage: {
        async readPreferredMarkdown() {
          return "# X";
        },
        async readParseStatus() {
          return { preciseReady: true, liteReady: true };
        },
      },
      searchItems: async () => [],
    });

    await assertRejectsCode(
      () => deps.searchByTitle({ libraryID: 1 }),
      "invalid-request",
    );
  });

  it("summarizes year and creators for citation matching", async function () {
    const parent = fakeItem({
      id: 2,
      key: "ITEM1",
      regular: true,
      title: "Energy-Saving Task Scheduling",
      date: "2022-01-15",
      creators: [
        { firstName: "Qingfeng", lastName: "Chen" },
        { lastName: "Han", firstName: "Yu" },
        { name: "MDPI Publishing" },
      ],
      fields: {
        itemType: "journalArticle",
        publicationTitle: "Electronics",
        DOI: "10.3390/electronics11010001",
        extra: "Citation Key: chen2022energy",
      },
    });
    const service = createMarkdownQueryService(
      fakeDeps({
        markdown: "# Hidden",
        items: [parent],
        searchItems: async () => [parent],
      }),
    );

    const response = await service.searchByTitle({
      libraryID: 1,
      title: "Energy",
    });

    assert.deepEqual(response, {
      candidates: [
        {
          item: {
            itemID: 2,
            libraryID: 1,
            key: "ITEM1",
            type: "regular",
            title: "Energy-Saving Task Scheduling",
            year: "2022",
            creators: ["Chen, Qingfeng", "Han, Yu", "MDPI Publishing"],
            itemType: "journalArticle",
            publication: "Electronics",
            citekey: "chen2022energy",
            doi: "10.3390/electronics11010001",
          },
          attachments: [],
        },
      ],
    });
  });

  it("filters candidates by parsedOnly", async function () {
    const parentParsed = fakeItem({
      id: 2,
      key: "ITEM1",
      regular: true,
      title: "Parsed Item",
      attachments: [1],
    });
    const pdfParsed = fakeItem({
      id: 1,
      key: "PDF1",
      pdf: true,
      fileName: "parsed.pdf",
      parentItemID: 2,
    });
    const parentUnparsed = fakeItem({
      id: 4,
      key: "ITEM2",
      regular: true,
      title: "Unparsed Item",
      attachments: [3],
    });
    const pdfUnparsed = fakeItem({
      id: 3,
      key: "PDF2",
      pdf: true,
      fileName: "unparsed.pdf",
      parentItemID: 4,
    });

    const service = createMarkdownQueryService({
      items: fakeItems([parentParsed, pdfParsed, parentUnparsed, pdfUnparsed]),
      storage: {
        async readPreferredMarkdown() {
          return "# Ready";
        },
        async readBoxes() {
          return [];
        },
        async readParseStatus(ref) {
          if (ref.key === "PDF1") {
            return { preciseReady: true, liteReady: false };
          }
          return { preciseReady: false, liteReady: false };
        },
      },
      searchItems: async () => [parentParsed, parentUnparsed],
    });

    const response = await service.searchByTitle({
      libraryID: 1,
      title: "Item",
      parsedOnly: true,
    });

    assert.equal(response.candidates.length, 1);
    assert.equal(response.candidates[0].item.key, "ITEM1");
  });

  it("applies the limit after the parsedOnly filter", async function () {
    const parents = [
      fakeItem({ id: 2, key: "ITEM1", regular: true, attachments: [1] }),
      fakeItem({ id: 4, key: "ITEM2", regular: true, attachments: [3] }),
      fakeItem({ id: 6, key: "ITEM3", regular: true, attachments: [5] }),
    ];
    const pdfs = [
      fakeItem({ id: 1, key: "PDF1", pdf: true, parentItemID: 2 }),
      fakeItem({ id: 3, key: "PDF2", pdf: true, parentItemID: 4 }),
      fakeItem({ id: 5, key: "PDF3", pdf: true, parentItemID: 6 }),
    ];
    const searchLimits: Array<number | undefined> = [];
    const service = createMarkdownQueryService({
      items: fakeItems([...parents, ...pdfs]),
      storage: {
        async readPreferredMarkdown() {
          return "# Ready";
        },
        async readBoxes() {
          return [];
        },
        async readParseStatus(ref) {
          // Only the second and third items have a parse result.
          return {
            preciseReady: ref.key !== "PDF1",
            liteReady: false,
          };
        },
      },
      // Like the real search, the item search honors the limit it is given.
      searchItems: async (input) => {
        searchLimits.push(input.limit);
        return input.limit === undefined
          ? parents
          : parents.slice(0, input.limit);
      },
    });

    const response = await service.searchByTitle({
      libraryID: 1,
      title: "Item",
      parsedOnly: true,
      limit: 1,
    });

    assert.deepEqual(
      response.candidates.map((candidate) => candidate.item.key),
      ["ITEM2"],
    );
    assert.deepEqual(searchLimits, [undefined]);
  });

  it("exports BibTeX once per item revision across requests", async function () {
    const pdf = fakeItem({ id: 41, key: "BIBPDF", pdf: true });
    pdf.dateModified = "2026-01-01 00:00:00";
    let exports = 0;
    const service = createMarkdownQueryService({
      ...fakeDeps({ markdown: "# Paper", items: [pdf] }),
      exportBibTeX: async () => {
        exports += 1;
        return `@article{paper${exports}}`;
      },
    });
    const query = { libraryID: 1, key: "BIBPDF", granularity: "headings" };

    const first = (await service.queryMarkdown(
      query as Parameters<typeof service.queryMarkdown>[0],
    )) as { bibtex?: string };
    const second = (await service.queryMarkdown(
      query as Parameters<typeof service.queryMarkdown>[0],
    )) as { bibtex?: string };
    pdf.dateModified = "2026-02-01 00:00:00";
    const afterEdit = (await service.queryMarkdown(
      query as Parameters<typeof service.queryMarkdown>[0],
    )) as { bibtex?: string };

    assert.equal(first.bibtex, "@article{paper1}");
    assert.equal(second.bibtex, "@article{paper1}");
    assert.equal(afterEdit.bibtex, "@article{paper2}");
    assert.equal(exports, 2);
  });

  it("returns libraries through getLibraries", async function () {
    const service = createMarkdownQueryService({
      ...fakeDeps({ markdown: "# X" }),
      getLibraries: async () => [
        { libraryID: 1, name: "My Library", type: "user" },
        { libraryID: 2, name: "Lab", type: "group" },
      ],
    });

    const result = await service.getLibraries();
    assert.deepEqual(result, {
      libraries: [
        { libraryID: 1, name: "My Library", type: "user" },
        { libraryID: 2, name: "Lab", type: "group" },
      ],
    });
  });

  it("returns collections through getCollections with optional filtering", async function () {
    const service = createMarkdownQueryService({
      ...fakeDeps({ markdown: "# X" }),
      getCollections: async () => [
        { id: 10, key: "COL1", name: "Root", libraryID: 1 },
        { id: 11, key: "COL2", name: "Child", libraryID: 1, parentKey: "COL1" },
      ],
    });

    const all = await service.getCollections({ libraryID: 1 });
    assert.equal(all.collections.length, 2);

    const filtered = await service.getCollections({
      libraryID: 1,
      parentKey: "COL1",
    });
    assert.equal(filtered.collections.length, 1);
    assert.equal(filtered.collections[0].key, "COL2");
  });

  it("returns tags through getTags with optional limit", async function () {
    const service = createMarkdownQueryService({
      ...fakeDeps({ markdown: "# X" }),
      getTags: async (_libId, limit) => {
        const allTags = [
          { tag: "ai", numItems: 10 },
          { tag: "ml", numItems: 5 },
        ];
        return limit ? allTags.slice(0, limit) : allTags;
      },
    });

    const tags = await service.getTags({ libraryID: 1, limit: 1 });
    assert.deepEqual(tags, {
      libraryID: 1,
      tags: [{ tag: "ai", numItems: 10 }],
    });
  });

  it("reads tags from Zotero's asynchronous tag list without an injected reader", async function () {
    const zotero = Zotero as unknown as {
      Tags?: { getAll?: (libraryID: number) => Promise<unknown> };
    };
    const originalTags = zotero.Tags;
    const originalGetAll = originalTags?.getAll;
    const tagsApi = originalTags ?? {};
    zotero.Tags = tagsApi;
    tagsApi.getAll = async (libraryID) => {
      assert.equal(libraryID, 1);
      // Zotero lists a tag once per type (manual and automatic).
      return [
        { tag: "ai", type: 0 },
        { tag: "ml", type: 0 },
        { tag: "ai", type: 1 },
      ];
    };

    try {
      const service = createMarkdownQueryService(fakeDeps({ markdown: "# X" }));

      assert.deepEqual(await service.getTags({ libraryID: 1 }), {
        libraryID: 1,
        tags: [{ tag: "ai" }, { tag: "ml" }],
      });
      assert.deepEqual(await service.getTags({ libraryID: 1, limit: 1 }), {
        libraryID: 1,
        tags: [{ tag: "ai" }],
      });
    } finally {
      if (originalTags) {
        originalTags.getAll = originalGetAll;
      } else {
        delete zotero.Tags;
      }
    }
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
  searchItems?: (input: ItemSearchInput) => Promise<ZoteroItemLike[]>;
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
      async readBoxes() {
        return [];
      },
      async readParseStatus() {
        return parseStatus;
      },
    },
    async searchItems(searchInput: ItemSearchInput) {
      if (input.searchItems) {
        return input.searchItems(searchInput);
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
  date?: string;
  creators?: CreatorLike[];
  parentItemID?: number | false;
  attachments?: number[];
  bestAttachments?: ZoteroItemLike[];
  fields?: Record<string, string>;
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
    getField: (field) => {
      if (input.fields?.[field]) {
        return input.fields[field];
      }
      if (field === "title") {
        return input.title ?? "";
      }
      if (field === "date") {
        return input.date ?? "";
      }
      return "";
    },
    getAttachments: () => input.attachments ?? [],
    getBestAttachments: async () => input.bestAttachments ?? [],
    ...(input.creators ? { getCreators: () => input.creators } : {}),
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
