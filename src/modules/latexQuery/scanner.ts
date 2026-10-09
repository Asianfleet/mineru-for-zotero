export interface LatexCommand {
  name: string;
  starred: boolean;
  start: number;
  end: number;
  argument?: string;
}

/** 扫描 LaTeX 命令，跳过注释并平衡读取花括号参数。 */
export function scanLatexCommands(text: string): LatexCommand[] {
  const commands: LatexCommand[] = [];
  for (let index = 0; index < text.length; ) {
    if (text[index] === "%") {
      index = skipComment(text, index);
      continue;
    }
    if (text[index] !== "\\") {
      index += 1;
      continue;
    }
    const start = index;
    index += 1;
    if (!/[A-Za-z]/.test(text[index] ?? "")) {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (/[A-Za-z]/.test(text[index] ?? "")) index += 1;
    const name = text.slice(nameStart, index);
    const starred = text[index] === "*";
    if (starred) index += 1;
    const nameEnd = index;
    while (/\s/.test(text[index] ?? "")) index += 1;
    if (text[index] === "[") {
      const optional = readGroup(text, index, "[", "]");
      if (optional) {
        index = optional.end;
        while (/\s/.test(text[index] ?? "")) index += 1;
      }
    }
    const argument =
      text[index] === "{" ? readGroup(text, index, "{", "}") : undefined;
    commands.push({
      name,
      starred,
      start,
      end: argument?.end ?? nameEnd,
      argument: argument?.value,
    });
    index = argument?.end ?? nameEnd;
  }
  return commands;
}

/** 去掉排版命令与分组符，得到可用于标题和 caption 查询的文字。 */
export function plainLatexText(text: string): string {
  let output = "";
  for (let index = 0; index < text.length; ) {
    const char = text[index];
    if (char === "%") {
      index = skipComment(text, index);
    } else if (char === "\\") {
      index += 1;
      if (/[A-Za-z]/.test(text[index] ?? "")) {
        while (/[A-Za-z]/.test(text[index] ?? "")) index += 1;
      } else if (index < text.length) {
        output += text[index];
        index += 1;
      }
    } else {
      if (char !== "{" && char !== "}") output += char;
      index += 1;
    }
  }
  return output.replace(/\s+/g, " ").trim();
}

/** 读取一组允许嵌套和转义的命令参数。 */
function readGroup(
  text: string,
  start: number,
  open: string,
  close: string,
): { value: string; end: number } | undefined {
  let depth = 1;
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }
    if (text[index] === "%") {
      index = skipComment(text, index) - 1;
      continue;
    }
    if (text[index] === open) depth += 1;
    if (text[index] === close && --depth === 0)
      return { value: text.slice(start + 1, index), end: index + 1 };
  }
  return undefined;
}

/** 跳过未转义百分号到行尾的注释。 */
function skipComment(text: string, start: number): number {
  const end = text.indexOf("\n", start);
  return end === -1 ? text.length : end;
}
