import {
  MarkdownHeading,
  MarkdownQueryError,
  MarkdownSearchMatch,
  MarkdownSectionGroup,
  MarkdownSectionMatch,
  MarkdownSectionResult,
  MarkdownTableSource,
} from "./types";

const ATX_HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TOP_LEVEL_TITLE = /^#\s+.+$/;

/**
 * 解析 Markdown ATX 标题，并为每个标题生成层级路径。
 */
export function parseHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const stack: MarkdownHeading[] = [];

  markdown.split(/\r?\n/).forEach((line, index) => {
    const match = ATX_HEADING.exec(line);
    if (!match) {
      return;
    }

    const level = match[1].length;
    const title = match[2].trim();
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const headingNumber = extractHeadingNumber(title);
    const heading: MarkdownHeading = {
      level,
      title,
      path: [...stack.map((item) => item.title), title],
      line: index,
    };
    if (headingNumber) {
      heading.number = headingNumber;
    }
    headings.push(heading);
    stack.push(heading);
  });

  return headings;
}

/**
 * 根据 heading path 返回章节内容，包含章节标题行。
 */
export function readSection(
  markdown: string,
  sectionPath: string[] | string,
): MarkdownSectionResult {
  const path = normalizeSectionPath(sectionPath);
  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  const matches = headings.filter((heading) => samePath(heading.path, path));

  if (matches.length === 0) {
    throw new MarkdownQueryError("section-not-found", 404, "section-not-found");
  }
  if (matches.length > 1) {
    throw new MarkdownQueryError(
      "ambiguous-section",
      409,
      "ambiguous-section",
      { candidates: matches },
    );
  }

  const heading = matches[0];
  const nextHeading = headings.find(
    (candidate) =>
      candidate.line > heading.line && candidate.level <= heading.level,
  );
  const endLine = nextHeading?.line ?? lines.length;

  return {
    heading,
    content: lines.slice(heading.line, endLine).join("\n").trimEnd(),
  };
}

/**
 * 根据章节号或模糊路径表达式返回分组 section。
 */
export function readSectionGroups(
  markdown: string,
  input: { sectionNumber?: string; sectionPath?: string },
): MarkdownSectionGroup[] {
  const sectionNumber = input.sectionNumber?.trim() ?? "";
  const sectionPath = input.sectionPath?.trim() ?? "";
  if (sectionNumber && sectionPath) {
    throw new MarkdownQueryError(
      "invalid-request",
      400,
      "sectionNumber and sectionPath cannot be used together",
    );
  }
  if (!sectionNumber && !sectionPath) {
    throw new MarkdownQueryError("missing-query", 400, "missing-query");
  }

  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  if (sectionNumber) {
    return splitQueryGroups(sectionNumber).map((query) =>
      readSectionNumberGroup(lines, headings, query),
    );
  }
  return splitQueryGroups(sectionPath).map((query) =>
    readSectionPathGroup(lines, headings, query),
  );
}

/**
 * 提取 Markdown 图片链接中的相对 path，保持原始顺序并去重。
 */
export function extractMarkdownImageLinks(markdown: string): string[] {
  const paths: string[] = [];
  for (const match of markdown.matchAll(
    /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const path = match[1].trim();
    if (!paths.includes(path)) {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * 从 Markdown 中提取裸 HTML table，供 lite 结果降级查询使用。
 */
export function extractMarkdownTables(markdown: string): MarkdownTableSource[] {
  return [...markdown.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(
    (match, index) => ({
      rawIndex: index,
      html: match[0],
      text: normalizeSearchText(match[0]),
    }),
  );
}

/**
 * 按空行分隔段落，返回包含前后上下文的关键词命中。
 */
export function searchMarkdown(
  markdown: string,
  query: string,
  contextParagraphs = 1,
): MarkdownSearchMatch[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    throw new MarkdownQueryError("missing-query", 400, "missing-query");
  }

  const contextSize = Math.max(0, Math.floor(contextParagraphs));
  const paragraphs = markdown
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const searchableParagraphs =
    paragraphs.length > 0 && TOP_LEVEL_TITLE.test(paragraphs[0])
      ? paragraphs.slice(1)
      : paragraphs;

  return searchableParagraphs.flatMap((paragraph, index) => {
    if (!paragraph.toLowerCase().includes(normalizedQuery)) {
      return [];
    }

    const before = searchableParagraphs.slice(
      Math.max(0, index - contextSize),
      index,
    );
    const after = searchableParagraphs.slice(
      index + 1,
      index + 1 + contextSize,
    );
    return [
      {
        paragraphIndex: index,
        context: [...before, paragraph, ...after].join("\n\n"),
        before,
        hit: paragraph,
        after,
      },
    ];
  });
}

/**
 * 统一 section path 的字符串与数组输入格式。
 */
function normalizeSectionPath(path: string[] | string): string[] {
  if (Array.isArray(path)) {
    return path.map((part) => part.trim()).filter(Boolean);
  }

  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 判断两个标题路径是否完全一致。
 */
function samePath(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}

/**
 * 将逗号分隔的章节查询表达式拆成非空分组。
 */
function splitQueryGroups(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 根据单个章节号或章节号范围查询分组。
 */
function readSectionNumberGroup(
  lines: string[],
  headings: MarkdownHeading[],
  query: string,
): MarkdownSectionGroup {
  if (query.includes("-")) {
    return readSectionNumberRangeGroup(lines, headings, query);
  }

  const matches = headings.filter((heading) => heading.number === query);
  if (matches.length === 0) {
    return emptyGroup(query, "section-number", "not-found");
  }
  if (matches.length > 1) {
    return {
      ...emptyGroup(query, "section-number", "ambiguous"),
      candidates: matches,
    };
  }
  return okGroup(query, "section-number", [
    sectionMatchForHeading(lines, headings, matches[0]),
  ]);
}

/**
 * 根据同一主章节内的起止章节号读取范围分组。
 */
function readSectionNumberRangeGroup(
  lines: string[],
  headings: MarkdownHeading[],
  query: string,
): MarkdownSectionGroup {
  const [start, end, extra] = query.split("-").map((part) => part.trim());
  if (
    !start ||
    !end ||
    extra ||
    mainSectionNumber(start) !== mainSectionNumber(end)
  ) {
    return emptyGroup(query, "section-number-range", "invalid-range");
  }

  const startMatches = headings.filter((heading) => heading.number === start);
  const endMatches = headings.filter((heading) => heading.number === end);
  const ambiguousCandidates = [...startMatches, ...endMatches].filter(
    (heading) =>
      (heading.number === start && startMatches.length > 1) ||
      (heading.number === end && endMatches.length > 1),
  );
  if (ambiguousCandidates.length > 0) {
    return {
      ...emptyGroup(query, "section-number-range", "ambiguous"),
      candidates: ambiguousCandidates,
    };
  }
  if (startMatches.length === 0 || endMatches.length === 0) {
    return emptyGroup(query, "section-number-range", "not-found");
  }
  if (compareSectionNumbers(start, end) > 0) {
    return emptyGroup(query, "section-number-range", "invalid-range");
  }

  return okGroup(
    query,
    "section-number-range",
    headings
      .filter(
        (heading) =>
          heading.number &&
          mainSectionNumber(heading.number) === mainSectionNumber(start) &&
          compareSectionNumbers(heading.number, start) >= 0 &&
          compareSectionNumbers(heading.number, end) <= 0,
      )
      .map((heading) => sectionMatchForHeading(lines, headings, heading)),
  );
}

/**
 * 根据模糊章节路径查询分组。
 */
function readSectionPathGroup(
  lines: string[],
  headings: MarkdownHeading[],
  query: string,
): MarkdownSectionGroup {
  const normalizedQuery = normalizeSearchText(query);
  const matches = headings.filter((heading) =>
    normalizeSearchText(heading.path.join(" / ")).includes(normalizedQuery),
  );
  if (matches.length === 0) {
    return emptyGroup(query, "section-path", "not-found");
  }
  if (matches.length > 1) {
    return {
      ...emptyGroup(query, "section-path", "ambiguous"),
      candidates: matches,
    };
  }
  return okGroup(query, "section-path", [
    sectionMatchForHeading(lines, headings, matches[0]),
  ]);
}

/**
 * 将指定标题转换为包含正文和图片引用的章节命中。
 */
function sectionMatchForHeading(
  lines: string[],
  headings: MarkdownHeading[],
  heading: MarkdownHeading,
): MarkdownSectionMatch {
  const nextHeading = headings.find(
    (candidate) =>
      candidate.line > heading.line && candidate.level <= heading.level,
  );
  const endLine = nextHeading?.line ?? lines.length;
  const content = lines.slice(heading.line, endLine).join("\n").trimEnd();
  return {
    heading,
    content,
    images: extractMarkdownImageLinks(content),
  };
}

/**
 * 构造成功的章节分组结果。
 */
function okGroup(
  query: string,
  kind: MarkdownSectionGroup["kind"],
  matches: MarkdownSectionMatch[],
): MarkdownSectionGroup {
  return { query, kind, status: "ok", matches, warnings: [] };
}

/**
 * 构造没有章节命中的分组结果。
 */
function emptyGroup(
  query: string,
  kind: MarkdownSectionGroup["kind"],
  status: MarkdownSectionGroup["status"],
): MarkdownSectionGroup {
  return { query, kind, status, matches: [], warnings: [] };
}

/**
 * 从标题文本开头提取章节编号。
 */
function extractHeadingNumber(title: string): string | undefined {
  return /^([A-Z]?(?:\d+|[A-Z])(?:\.\d+)*)(?:\.|\s)/i
    .exec(title.trim())?.[1]
    ?.replace(/\.$/, "");
}

/**
 * 返回章节号的主章节部分，用于限制范围查询。
 */
function mainSectionNumber(value: string): string {
  return value.split(".")[0].toUpperCase();
}

/**
 * 按章节号 token 比较两个章节号，避免字符串或行号排序误判。
 */
function compareSectionNumbers(left: string, right: string): number {
  const leftTokens = sectionNumberTokens(left);
  const rightTokens = sectionNumberTokens(right);
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index++) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === undefined) {
      return -1;
    }
    if (rightToken === undefined) {
      return 1;
    }
    const comparison = compareSectionNumberToken(leftToken, rightToken);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

/**
 * 将章节号拆为逐级比较的 token。
 */
function sectionNumberTokens(value: string): string[] {
  return value
    .split(".")
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * 比较单个章节号 token，纯数字 token 使用数值顺序。
 */
function compareSectionNumberToken(left: string, right: string): number {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return Number(left) - Number(right);
  }
  return left.localeCompare(right);
}

/**
 * 将查询和可搜索文本归一化为小写空格分隔文本。
 */
function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}/.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
