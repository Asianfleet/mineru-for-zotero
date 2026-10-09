import {
  createLatexDocumentIndex,
  type LatexDocumentIndex,
} from "./documentIndex";
import { plainLatexText, scanLatexCommands } from "./scanner";

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
  level: number;
  offset: number;
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

const HEADING_RANK: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
};
const TABLE_ENVIRONMENTS = new Set([
  "table",
  "table*",
  "tabular",
  "tabular*",
  "longtable",
]);

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
    for (const command of scanLatexCommands(content)) {
      if (
        (command.name !== "input" && command.name !== "include") ||
        !command.argument
      )
        continue;
      const start = command.start;
      const requested = command.argument.trim();
      const base = relativePath(path, requested);
      const child = [base, `${base}.tex`].find((candidate) =>
        byPath.has(candidate),
      );
      if (!child) continue;
      if (start > cursor) {
        segments.push({
          text: content.slice(cursor, start),
          file: path,
          lineStart: lineNumber(content, cursor),
        });
      }
      visit(child);
      cursor = command.end;
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
export function parseLatexHeadings(
  segments: LatexSegment[],
  document = createLatexDocumentIndex(segments),
): LatexHeading[] {
  const commands = scanLatexCommands(document.text).filter(
    (command) => command.name in HEADING_RANK && command.argument !== undefined,
  );
  const firstRank = Math.min(
    ...commands.map((command) => HEADING_RANK[command.name]),
  );
  const stack: Array<{ rank: number; title: string }> = [];
  const headings: LatexHeading[] = [];
  for (const command of commands) {
    const rank = HEADING_RANK[command.name];
    const title = plainLatexText(command.argument ?? "");
    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    headings.push({
      command: `${command.name}${command.starred ? "*" : ""}`,
      title,
      path: [...stack.map((item) => item.title), title],
      ...document.locate(command.start),
      level: rank - firstRank + 1,
      offset: command.start,
    });
    stack.push({ rank, title });
  }
  return headings;
}

/** 查找完整表格环境，并避免将 table 内的 tabular 重复报告。 */
export function extractLatexTables(
  segments: LatexSegment[],
  document = createLatexDocumentIndex(segments),
): LatexTable[] {
  const tables: LatexTable[] = [];
  const stack: Array<{ name: string; start: number; report: boolean }> = [];
  for (const command of scanLatexCommands(document.text)) {
    const name = command.argument?.trim();
    if (!name) continue;
    if (command.name === "begin") {
      stack.push({
        name,
        start: command.start,
        report:
          TABLE_ENVIRONMENTS.has(name) &&
          !stack.some((entry) => TABLE_ENVIRONMENTS.has(entry.name)),
      });
    } else if (command.name === "end") {
      let matchIndex = stack.length - 1;
      while (matchIndex >= 0 && stack[matchIndex].name !== name) matchIndex--;
      if (matchIndex < 0) continue;
      const [entry] = stack.splice(matchIndex);
      if (!entry.report) continue;
      const content = document.text.slice(entry.start, command.end);
      const inner = scanLatexCommands(content);
      const caption = inner.find((item) => item.name === "caption")?.argument;
      const label = inner.find((item) => item.name === "label")?.argument;
      tables.push({
        content,
        environment: name,
        caption: caption === undefined ? undefined : plainLatexText(caption),
        label: label === undefined ? undefined : plainLatexText(label),
        file: document.locate(entry.start).file,
        lineStart: document.locate(entry.start).line,
        lineEnd: document.locate(Math.max(entry.start, command.end - 1)).line,
      });
    }
  }
  return tables;
}

/** 在展开后的源码行中查找关键词，并返回原文件位置。 */
export function searchLatex(
  segments: LatexSegment[],
  query: string,
  contextParagraphs = 1,
  document: LatexDocumentIndex = createLatexDocumentIndex(segments),
): Array<{
  hit: string;
  file: string;
  line: number;
  before: string[];
  after: string[];
}> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const lines = document.text.split("\n");
  const paragraphs: Array<{ start: number; end: number; text: string }> = [];
  let start = -1;
  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index].trim()) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      paragraphs.push({
        start,
        end: index,
        text: lines.slice(start, index).join("\n").trim(),
      });
      start = -1;
    }
  }
  const matches = [];
  let offset = 0;
  const count = Math.max(0, Math.floor(contextParagraphs));
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\r$/, "");
    if (line.toLowerCase().includes(needle)) {
      const paragraphIndex = paragraphs.findIndex(
        (paragraph) => index >= paragraph.start && index < paragraph.end,
      );
      matches.push({
        hit: line.trim(),
        ...document.locate(offset),
        before: paragraphs
          .slice(Math.max(0, paragraphIndex - count), paragraphIndex)
          .map((paragraph) => paragraph.text),
        after: paragraphs
          .slice(paragraphIndex + 1, paragraphIndex + count + 1)
          .map((paragraph) => paragraph.text),
      });
    }
    offset += rawLine.length + 1;
  }
  return matches;
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
