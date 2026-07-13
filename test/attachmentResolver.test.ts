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
    const a = fakeItem({
      id: 2,
      key: "PDFA",
      pdf: true,
      fileName: "paper-copy-a.pdf",
      dateAdded: "2026-01-01 00:00:00",
    });
    const b = fakeItem({
      id: 3,
      key: "PDFB",
      pdf: true,
      fileName: "paper-copy-b.pdf",
      dateAdded: "2026-01-01 00:00:00",
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [],
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

  it("selects the unique highest-scoring attachment even when the gap is one point", async function () {
    const earlier = fakeItem({
      id: 2,
      key: "EARLY",
      pdf: true,
      fileName: "paper.pdf",
      dateAdded: "2026-01-01 00:00:00",
    });
    const later = fakeItem({
      id: 3,
      key: "LATE",
      pdf: true,
      fileName: "paper.pdf",
      dateAdded: "2026-12-31 00:00:00",
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [earlier, later],
      title: "paper",
    });

    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      items: fakeItems([parent, earlier, later]),
      storage: fakeStatus(),
    });

    assert.equal(result.attachment.key, "EARLY");
  });

  it("does not boost candidates with existing parse results", async function () {
    const original = fakeItem({
      id: 2,
      key: "ORIG",
      pdf: true,
      fileName: "example-paper.pdf",
    });
    const derived = fakeItem({
      id: 3,
      key: "DERIVED",
      pdf: true,
      fileName: "example-paper-annotated.pdf",
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [original, derived],
      title: "Example Paper",
    });

    const result = await resolveAttachment({
      libraryID: 1,
      key: "ITEM1",
      items: fakeItems([parent, original, derived]),
      storage: fakeStatus({
        ORIG: { preciseReady: false, liteReady: false },
        DERIVED: { preciseReady: true, liteReady: true },
      }),
    });

    assert.equal(result.attachment.key, "ORIG");
    const derivedCandidate = (result.candidates ?? []).find(
      (candidate) => candidate.key === "DERIVED",
    );
    assert.isDefined(derivedCandidate);
    assert.include(derivedCandidate!, {
      key: "DERIVED",
      preciseReady: true,
      liteReady: true,
    });
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

  it("returns attachment-not-found when attachmentKey targets a non-pdf child", async function () {
    const pdf = fakeItem({ id: 2, key: "PDF1", pdf: true, parentItemID: 1 });
    const note = fakeItem({
      id: 3,
      key: "NOTE1",
      parentItemID: 1,
      fileName: "note.txt",
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2, 3],
      bestAttachments: [pdf],
    });

    await assertRejectsCode(
      () =>
        resolveAttachment({
          libraryID: 1,
          key: "ITEM1",
          attachmentKey: "NOTE1",
          items: fakeItems([parent, pdf, note]),
          storage: fakeStatus(),
        }),
      "attachment-not-found",
    );
  });

  it("returns attachment-not-found when attachmentKey targets a pdf outside the parent", async function () {
    const pdf = fakeItem({ id: 2, key: "PDF1", pdf: true, parentItemID: 1 });
    const foreignPdf = fakeItem({
      id: 3,
      key: "PDF2",
      pdf: true,
      parentItemID: 99,
    });
    const parent = fakeItem({
      id: 1,
      key: "ITEM1",
      regular: true,
      attachments: [2],
      bestAttachments: [pdf],
    });

    await assertRejectsCode(
      () =>
        resolveAttachment({
          libraryID: 1,
          key: "ITEM1",
          attachmentKey: "PDF2",
          items: fakeItems([parent, pdf, foreignPdf]),
          storage: fakeStatus(),
        }),
      "attachment-not-found",
    );
  });
});

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

function fakeStatus(
  statuses: Record<string, { preciseReady: boolean; liteReady: boolean }> = {},
) {
  return {
    async readParseStatus(ref: { key: string }) {
      return (
        statuses[ref.key] ?? {
          preciseReady: false,
          liteReady: false,
        }
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
