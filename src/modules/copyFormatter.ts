import type { FormulaCopyMode, NormalizedBox } from "./domain";

export function formatBoxesForCopy(boxes: NormalizedBox[]): string {
  return [...boxes]
    .sort((a, b) => a.rawIndex - b.rawIndex)
    .map(formatBoxForCopy)
    .filter(Boolean)
    .join("\n\n");
}

export function formatBoxForCopy(box: NormalizedBox): string {
  if (isDisplayFormulaBox(box)) {
    return formatFormulaBoxForCopy(box, "with-dollar");
  }

  if (isInlineFormulaBox(box) && !hasDollarWrappedFormula(box.markdown)) {
    return formatFormulaBoxForCopy(box, "with-dollar");
  }

  return box.markdown.trim();
}

export function formatFormulaBoxForCopy(
  box: NormalizedBox,
  mode: FormulaCopyMode,
): string {
  const formula = box.formula ?? box.markdown;
  if (mode === "without-dollar") {
    return stripOuterDollars(formula);
  }
  if (isDisplayFormulaBox(box)) {
    return `$$\n${stripOuterDollars(formula)}\n$$`;
  }
  return formatFormulaForCopy(stripOuterDollars(formula), "with-dollar");
}

export function formatFormulaForCopy(
  formula: string,
  mode: FormulaCopyMode,
): string {
  const value =
    mode === "with-dollar" ? stripOuterDollars(formula) : formula.trim();
  return mode === "with-dollar" ? `$${value}$` : value;
}

function isDisplayFormulaBox(box: NormalizedBox): boolean {
  return ["interline_equation", "equation_interline"].includes(
    normalizeBoxType(box.type),
  );
}

function isInlineFormulaBox(box: NormalizedBox): boolean {
  return ["inline_equation", "equation_inline"].includes(
    normalizeBoxType(box.type),
  );
}

function hasDollarWrappedFormula(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length >= 2 && trimmed.startsWith("$") && trimmed.endsWith("$")
  );
}

function stripOuterDollars(value: string): string {
  let stripped = value.trim();
  while (hasDollarWrappedFormula(stripped)) {
    stripped = stripped.slice(1, -1).trim();
  }
  return stripped;
}

function normalizeBoxType(type: string): string {
  return type.trim().toLowerCase();
}
