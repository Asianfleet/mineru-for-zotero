import { assert } from "chai";
import { resolveAttachment } from "../src/modules/markdownQuery/attachmentResolver";
import {
  MarkdownQueryError,
  ZoteroItemLike,
  ZoteroItemsGateway,
} from "../src/modules/markdownQuery/types";

describe("attachmentResolver", function () {
  it("resolves a PDF attachment key directly", async function () {
    const pdf = fakeItem({ id: 1, key: "PDF1", pdf: true });
    const result = await resolveAttachment({
      libraryID: 1,
      key: "PDF1",
      items: fakeItems([pdf]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "PDF1");
  });

  it("selects the only PDF attachment under a regular item", async function () {
    const pdf = fakeItem({ id: 2, key: "PDF2", pdf: true });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2],
      bestAttachments: [pdf],
      title: "Example Paper",
    });
    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      items: fakeItems([parent, pdf]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "PDF2");
  });

  it("prefers the original PDF over derived annotated files", async function () {
    const original = fakeItem({
      id: 2,
      key: "ORIG",
      pdf: true,
      fileName: "example-paper.pdf",
    });
    const annotated = fakeItem({
      id: 3,
      key: "ANN",
      pdf: true,
      fileName: "example-paper-annotated.pdf",
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [original, annotated],
      title: "Example Paper",
    });

    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      items: fakeItems([parent, original, annotated]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "ORIG");
  });

  it("returns ambiguous-attachment when candidates tie", async function () {
    const a = fakeItem({ id: 2, key: "PDFA", pdf: true, fileName: "a.pdf" });
    const b = fakeItem({ id: 3, key: "PDFB", pdf: true, fileName: "b.pdf" });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [a, b],
      title: "Unrelated Title",
    });

    await assertRejectsCode(
      () =>
        resolveAttachment({
          libraryID: 1,
          key: "ITEM1",
          items: fakeItems([parent, a, b]),
          storage: fakeStatus(),
        }),
      "ambiguous-attachment",
    );
  });

  it("uses attachmentKey to select a child PDF exactly", async function () {
    const a = fakeItem({ id: 2, key: "PDFA", pdf: true });
    const b = fakeItem({ id: 3, key: "PDFB", pdf: true });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [a, b],
    });

    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      attachmentKey: "PDFB",
      items: fakeItems([parent, a, b]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "PDFB");
  });
});

function fakeItem(input: {
  id: number;
  key: string;
  regular?: boolean;
  pdf?: boolean;
  title?: string;
  fileName?: string;
  attachments?: number[];
  bestAttachments?: ZoteroItemLike[];
}): ZoteroItemLike {
  return {
    id: input.id,
    key: input.key,
    libraryID: 1,
    dateAdded: `2026-01-${String(input.id).padStart(2, "0")} 00:00:00`,
    attachmentFilename: input.fileName ?? `${input.key}.pdf`,
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

function fakeStatus() {
  return {
    async readParseStatus() {
      return { preciseReady: false, liteReady: false };
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
