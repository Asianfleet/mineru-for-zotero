import {
  AttachmentCandidate,
  MarkdownQueryError,
  ParseStatusReader,
  ResolvedAttachment,
  ZoteroItemsGateway,
  ZoteroItemLike,
} from "./types";

const DERIVED_NAME_PATTERN =
  /(annotated|annotation|annotations|highlight|highlights|note|notes|translated|translation|copy|edited|批注|注释|高亮|笔记|翻译|译文|副本|修改)/i;

/**
 * 将 libraryID/key 解析为可用于 Markdown Query 的目标 PDF 附件。
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
 * 为候选 PDF 附件计算启发式分数，并附带解析状态信息。
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
 * 读取候选附件的稳定文件名，用于评分与诊断。
 */
function getAttachmentFileName(attachment: ZoteroItemLike): string {
  return attachment.attachmentFilename || attachment.getDisplayTitle();
}

/**
 * 基于标题与文件名的词项重叠计算简单相似度分数。
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
 * 将标题或文件名切分为用于相似度比较的稳定 token 集合。
 */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .filter((token) => token.length >= 2);
}
