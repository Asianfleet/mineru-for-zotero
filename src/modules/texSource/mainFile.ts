import { scanLatexCommands } from "../latexQuery/scanner";
import type { SourceArchiveFile } from "./archive";

/** 从 TeX 文件的有效命令中选择唯一入口，歧义时保留候选路径。 */
export function selectTexMainFile(
  files: SourceArchiveFile[],
  requestedMainFile?: string,
): string {
  const texFiles = files.filter((file) =>
    file.path.toLowerCase().endsWith(".tex"),
  );
  if (requestedMainFile !== undefined) {
    const requested = texFiles.find((file) => file.path === requestedMainFile);
    if (!requested) throw new Error("invalid-main-file");
    return requested.path;
  }
  const candidates = texFiles.map((file) => {
    const commands = scanLatexCommands(new TextDecoder().decode(file.bytes));
    const hasClass = commands.some(
      (command) =>
        command.name === "documentclass" && Boolean(command.argument),
    );
    const hasDocument = commands.some(
      (command) =>
        command.name === "begin" && command.argument?.trim() === "document",
    );
    return { path: file.path, score: Number(hasClass) + Number(hasDocument) };
  });
  const bestScore = Math.max(1, ...candidates.map((file) => file.score));
  const best = candidates.filter((file) => file.score === bestScore);
  if (best.length !== 1) {
    throw Object.assign(new Error("ambiguous-main-file"), {
      candidates: best.map((file) => file.path).sort(),
    });
  }
  return best[0].path;
}
