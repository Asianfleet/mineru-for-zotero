const ARXIV =
  /(?:arxiv\s*:\s*|arxiv\.org\/(?:abs|pdf|src|e-print)\/)([a-z-]+\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i;

/** 从条目 Extra 和 URL 提取 arXiv ID，冲突时明确报错。 */
export function extractArxivId(fields: {
  extra?: string;
  url?: string;
}): string {
  const values = [fields.extra ?? "", fields.url ?? ""]
    .map((value) => ARXIV.exec(value)?.[1])
    .filter((value): value is string => Boolean(value));
  const unique = [...new Set(values.map((value) => value.toLowerCase()))];
  if (unique.length === 0) throw new Error("arxiv-id-not-found");
  if (unique.length > 1) throw new Error("ambiguous-arxiv-id");
  return values.find((value) => value.toLowerCase() === unique[0])!;
}

/** 返回不含版本号的 arXiv ID，供最新版下载地址使用。 */
export function stripArxivVersion(id: string): string {
  return id.replace(/v\d+$/i, "");
}
