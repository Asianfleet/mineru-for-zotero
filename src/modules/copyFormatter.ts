import type { FormulaCopyMode, NormalizedBox } from "./domain";

export function formatBoxesForCopy(boxes: NormalizedBox[]): string {
  return [...boxes]
    .sort((a, b) => a.rawIndex - b.rawIndex)
    .map((box) => box.markdown.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function formatFormulaForCopy(
  formula: string,
  mode: FormulaCopyMode,
): string {
  const value = formula.trim();
  return mode === "with-dollar" ? `$${value}$` : value;
}
