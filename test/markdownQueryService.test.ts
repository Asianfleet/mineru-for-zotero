import { assert } from "chai";
import { createMarkdownQueryService } from "../src/modules/markdownQuery/queryService";
import {
  MarkdownQueryError,
  ZoteroItemLike,
  ZoteroItemsGateway,
} from "../src/modules/markdownQuery/types";

describe("markdownQueryService", function () {
  it("returns full markdown after resolving an attachment", async function () {
    const service = createMarkdownQueryService(fakeDeps("# Precise"));

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.include(JSON.stringify(response), "# Precise");
  });

  it("uses preferred markdown so lite-only results can be returned", async function () {
    const service = createMarkdownQueryService(fakeDeps("# Lite"));

    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "full",
    });

    assert.include(JSON.stringify(response), "# Lite");
  });

  it("returns heading granularity", async function () {
    const service = createMarkdownQueryService(fakeDeps("# A\n\n## B"));
    const response = await service.queryMarkdown({
      libraryID: 1,
      key: "PDF1",
      granularity: "headings",
    });

    assert.deepInclude(response, { granularity: "headings" });
    assert.include(JSON.stringify(response), '"title":"B"');
  });

  it("maps missing markdown to parse-result-not-found", async function () {
    const service = createMarkdownQueryService(
      fakeDeps("# Missing", async () => {
        throw new Error("not found");
      }),
    );

    await assertRejectsCode(
      () => service.queryMarkdown({ libraryID: 1, key: "PDF1" }),
      "parse-result-not-found",
    );
  });
});

function fakeDeps(
  markdown: string,
  readPreferredMarkdown?: (ref: {
    libraryID: number;
    key: string;
  }) => Promise<string>,
) {
  const pdf = fakeItem({
    id: 1,
    key: "PDF1",
    pdf: true,
    fileName: "paper.pdf",
  });

  return {
    items: fakeItems([pdf]),
    storage: {
      async readPreferredMarkdown(ref: { libraryID: number; key: string }) {
        if (readPreferredMarkdown) {
          return readPreferredMarkdown(ref);
        }
        return markdown;
      },
      async readParseStatus() {
        return { preciseReady: true, liteReady: true };
      },
    },
    async searchItemsByTitle() {
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
