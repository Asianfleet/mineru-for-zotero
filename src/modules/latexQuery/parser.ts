export interface LatexSourceFile {
  path: string;
  content: string;
}

export interface LatexSegment {
  text: string;
  file: string;
  lineStart: number;
}

export interface LatexHeading {
  command: string;
  title: string;
  path: string[];
  file: string;
  line: number;
}

export interface LatexTable {
  content: string;
  environment: string;
  caption?: string;
  label?: string;
  file: string;
  lineStart: number;
  lineEnd: number;
}

const INCLUDE = /\\(?:input|include)\s*\{([^}]+)\}/g;
const SECTION =
  /\\(part|chapter|section|subsection|subsubsection)\*?\s*\{([^}]*)\}/g;
const TABLE_START = /\\begin\s*\{(table\*?|tabular\*?|longtable)\}/g;

/** 按主文件的引用顺序展开源码，同时记录每段的原始文件和起始行。 */
export function expandLatexSource(
  files: LatexSourceFile[],
  mainFile: string,
): LatexSegment[] {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const segments: LatexSegment[] = [];
  const visiting = new Set<string>();

  /** 遍历单个源码文件，并阻止循环引用。 */
  function visit(path: string): void {
    const content = byPath.get(path);
    if (content === undefined || visiting.has(path)) return;
    visiting.add(path);
    let cursor = 0;
    for (const match of content.matchAll(INCLUDE)) {
      const start = match.index ?? 0;
      if (start > cursor) {
        segments.push({
          text: content.slice(cursor, start),
          file: path,
          lineStart: lineNumber(content, cursor),
        });
      }
      const requested = match[1].trim();
      const base = relativePath(path, requested);
      const child = [base, `${base}.tex`].find((candidate) =>
        byPath.has(candidate),
      );
      if (child) visit(child);
      cursor = start + match[0].length;
    }
    if (cursor < content.length) {
      segments.push({
        text: content.slice(cursor),
        file: path,
        lineStart: lineNumber(content, cursor),
      });
    }
    visiting.delete(path);
  }

  visit(mainFile);
  return segments;
}

/** 按 LaTeX 章节命令建立标题层级路径。 */
export function parseLatexHeadings(segments: LatexSegment[]): LatexHeading[] {
  const levels = {
    part: 0,
    chapter: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
  };
  const stack: Array<{ level: number; title: string }> = [];
  const headings: LatexHeading[] = [];
  for (const segment of segments) {
    for (const match of segment.text.matchAll(SECTION)) {
      const command = match[1] as keyof typeof levels;
      const title = match[2].trim();
      const level = levels[command];
      while (stack.length && stack[stack.length - 1].level >= level)
        stack.pop();
      headings.push({
        command,
        title,
        path: [...stack.map((item) => item.title), title],
        file: segment.file,
        line:
          segment.lineStart + lineNumber(segment.text, match.index ?? 0) - 1,
      });
      stack.push({ level, title });
    }
  }
  return headings;
}

/** 查找完整表格环境，并避免将 table 内的 tabular 重复报告。 */
export function extractLatexTables(segments: LatexSegment[]): LatexTable[] {
  const tables: LatexTable[] = [];
  for (const segment of segments) {
    const covered: Array<[number, number]> = [];
    for (const match of segment.text.matchAll(TABLE_START)) {
      const start = match.index ?? 0;
      if (covered.some(([from, to]) => start >= from && start < to)) continue;
      const environment = match[1];
      const end = environmentEnd(
        segment.text,
        environment,
        start + match[0].length,
      );
      if (end === -1) continue;
      covered.push([start, end]);
      const content = segment.text.slice(start, end);
      tables.push({
        content,
        environment,
        caption: /\\caption\*?\s*\{([^}]*)\}/.exec(content)?.[1]?.trim(),
        label: /\\label\s*\{([^}]*)\}/.exec(content)?.[1]?.trim(),
        file: segment.file,
        lineStart: segment.lineStart + lineNumber(segment.text, start) - 1,
        lineEnd: segment.lineStart + lineNumber(segment.text, end) - 1,
      });
    }
  }
  return tables;
}

/** 在展开后的源码行中查找关键词，并返回原文件位置。 */
export function searchLatex(
  segments: LatexSegment[],
  query: string,
): Array<{ hit: string; file: string; line: number }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return segments.flatMap((segment) =>
    segment.text.split(/\r?\n/).flatMap((line, index) =>
      line.toLowerCase().includes(needle)
        ? [
            {
              hit: line.trim(),
              file: segment.file,
              line: segment.lineStart + index,
            },
          ]
        : [],
    ),
  );
}

/** 寻找同名 begin/end 的平衡终点。 */
function environmentEnd(
  text: string,
  environment: string,
  from: number,
): number {
  const escaped = environment.replace(/\*/g, "\\*");
  const tokens = new RegExp(`\\\\(begin|end)\\s*\\{${escaped}\\}`, "g");
  tokens.lastIndex = from;
  let depth = 1;
  for (const match of text.slice(from).matchAll(tokens)) {
    if (match[1] === "begin") depth += 1;
    else if (--depth === 0) return from + (match.index ?? 0) + match[0].length;
  }
  return -1;
}

/** 计算字符偏移对应的 1-based 行号。 */
function lineNumber(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r?\n/).length;
}

/** 将引用路径解析到源文件所在目录，拒绝逃出源码树。 */
function relativePath(parent: string, child: string): string {
  const parts = parent.split("/").slice(0, -1);
  for (const part of child.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}
