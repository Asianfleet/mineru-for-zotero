import {
  AttachmentCandidate,
  MarkdownQueryError,
  ParseStatusReader,
  ResolvedAttachment,
  ZoteroItemsGateway,
  ZoteroItemLike,
} from "./types";

// Derived PDFs (annotated, highlighted, translated, copied, edited) can carry
// Chinese labels in their file names, so the CJK alternatives below are part of
// the match. They are written as \uXXXX escapes because this repository must not
// contain literal CJK characters.
const DERIVED_NAME_PATTERN =
  /(annotated|annotation|annotations|highlight|highlights|note|notes|translated|translation|copy|edited|\u6279\u6ce8|\u6ce8\u91ca|\u9ad8\u4eae|\u7b14\u8bb0|\u7ffb\u8bd1|\u8bd1\u6587|\u526f\u672c|\u4fee\u6539)/i;

/**
 * Resolve a libraryID/key pair into a target PDF attachment usable for Markdown Query.
 */
export async function resolveAttachment(input: {
  libraryID: number;
  key: string;
  attachmentKey?: string;
  items: ZoteroItemsGateway;
  storage: ParseStatusReader;
}): Promise<ResolvedAttachment> {
  const item = await input.items.getByLibraryAndKeyAsync(
    input.libraryID,
    input.key,
  );
  if (!item) {
    throw new MarkdownQueryError("item-not-found", 404, "Item was not found");
  }

  if (item.isPDFAttachment()) {
    return { item, attachment: item };
  }

  if (!item.isRegularItem()) {
    throw new MarkdownQueryError(
      "pdf-attachment-not-found",
      404,
      "Item is not a regular item or PDF attachment",
    );
  }

  const attachments = (
    await input.items.getAsync(item.getAttachments(false))
  ).filter((candidate) => candidate.isPDFAttachment());

  if (attachments.length === 0) {
    throw new MarkdownQueryError(
      "pdf-attachment-not-found",
      404,
      "Regular item has no PDF attachments",
    );
  }

  if (input.attachmentKey) {
    const attachment = attachments.find(
      (candidate) => candidate.key === input.attachmentKey,
    );
    if (!attachment) {
      throw new MarkdownQueryError(
        "attachment-not-found",
        404,
        "Attachment key does not belong to the regular item",
      );
    }

    return { item, attachment };
  }

  const candidates = await scoreCandidates(item, attachments, input.storage);
  const topScore = Math.max(...candidates.map((candidate) => candidate.score));
  const winners = candidates.filter(
    (candidate) => candidate.score === topScore,
  );
  if (winners.length !== 1) {
    throw new MarkdownQueryError(
      "ambiguous-attachment",
      409,
      "Multiple PDF attachments may be the original paper. Specify attachmentKey to fetch one.",
      { candidates },
    );
  }

  const attachment = attachments.find(
    (candidate) => candidate.key === winners[0].key,
  );
  if (!attachment) {
    throw new MarkdownQueryError(
      "internal-error",
      500,
      "Selected attachment disappeared",
    );
  }

  return { item, attachment, candidates };
}

/**
 * Calculate heuristic scores for candidate PDF attachments along with parse status info.
 */
async function scoreCandidates(
  parent: ZoteroItemLike,
  attachments: ZoteroItemLike[],
  storage: ParseStatusReader,
): Promise<AttachmentCandidate[]> {
  const bestAttachments = await parent.getBestAttachments();
  const parentTitle = parent.getDisplayTitle() || parent.getField("title");

  return Promise.all(
    attachments.map(async (attachment) => {
      const reasons: string[] = [];
      let score = 100;
      const bestIndex = bestAttachments.findIndex(
        (candidate) => candidate.key === attachment.key,
      );
      if (bestIndex >= 0) {
        score += Math.max(0, 30 - bestIndex);
        reasons.push(`best-attachment-order:${bestIndex}`);
      }

      const fileName = getAttachmentFileName(attachment);
      if (
        DERIVED_NAME_PATTERN.test(`${fileName} ${attachment.getDisplayTitle()}`)
      ) {
        score -= 40;
        reasons.push("derived-name");
      }

      const similarity = titleSimilarity(parentTitle, fileName);
      if (similarity > 0) {
        score += similarity;
        reasons.push("title-similarity");
      }

      if (attachment.dateAdded) {
        score -= Math.min(10, Date.parse(attachment.dateAdded) / 10 ** 13);
        reasons.push(`date-added:${attachment.dateAdded}`);
      }

      const status = await storage.readParseStatus({
        libraryID: attachment.libraryID,
        key: attachment.key,
      });

      return {
        itemID: attachment.id,
        libraryID: attachment.libraryID,
        key: attachment.key,
        fileName,
        preciseReady: status.preciseReady,
        liteReady: status.liteReady,
        score: Math.round(score),
        reasons,
      };
    }),
  );
}

/**
 * Read a stable file name for candidate attachments for scoring and diagnostics.
 */
function getAttachmentFileName(attachment: ZoteroItemLike): string {
  return attachment.attachmentFilename || attachment.getDisplayTitle();
}

/**
 * Calculate a simple similarity score based on term overlap between title and file name.
 */
function titleSimilarity(title: string, fileName: string): number {
  const titleTokens = tokenize(title);
  const fileTokens = tokenize(fileName.replace(/\.pdf$/i, ""));
  if (titleTokens.length === 0 || fileTokens.length === 0) {
    return 0;
  }

  const overlap = titleTokens.filter((token) =>
    fileTokens.includes(token),
  ).length;
  return Math.round((overlap / titleTokens.length) * 20);
}

/**
 * Split a title or file name into a stable set of tokens for similarity comparison.
 */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 2);
}
